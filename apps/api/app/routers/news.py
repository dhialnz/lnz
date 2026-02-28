from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.market import NewsEvent
from app.models.user import User
from app.routers.holdings import get_holdings_for_user
from app.schemas.market import (
    HoldingImpactOut,
    NewsEventImpactOut,
    NewsEventOut,
    NewsPortfolioImpactOut,
)
from app.services.auth_service import get_current_user
from app.services.portfolio_scope import require_active_portfolio_id
from app.services import news as news_service
from app.services.news_impact import aggregate_top_impacted, impact_for_event

router = APIRouter(prefix="/news", tags=["news"])


def _event_rank(event: NewsEvent) -> float:
    return float((event.raw_payload or {}).get("rank_score", 0.0))


def _is_entity_match(event: NewsEvent, entity: Optional[str]) -> bool:
    if not entity:
        return True
    wanted = entity.upper()
    return any(str(e).upper() == wanted for e in (event.entities or []))


def _parse_captured_at(raw: object) -> datetime:
    if raw:
        try:
            return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except Exception:
            pass
    return datetime.now(tz=timezone.utc)


def _news_entities_from_holdings(holdings_snapshot) -> list[str]:
    entities: list[str] = []
    seen: set[str] = set()
    for h in holdings_snapshot.holdings:
        ticker = str(h.ticker or "").strip().upper()
        if ticker and ticker not in seen:
            entities.append(ticker)
            seen.add(ticker)
        name = re.sub(r"\s+", " ", str(h.name or "").strip())
        if len(name) >= 3:
            key = name.lower()
            if key not in seen:
                entities.append(name)
                seen.add(key)
    return entities


def _ingest_items(db: Session, items: list[dict]) -> list[NewsEvent]:
    created: list[NewsEvent] = []
    for item in items:
        if item.get("url"):
            exists = db.query(NewsEvent).filter(NewsEvent.url == item.get("url")).first()
            if exists:
                continue
        else:
            exists = (
                db.query(NewsEvent)
                .filter(
                    NewsEvent.source == item["source"],
                    NewsEvent.headline == item["headline"],
                )
                .first()
            )
            if exists:
                continue

        event = NewsEvent(
            captured_at=_parse_captured_at(item.get("captured_at")),
            headline=item["headline"],
            source=item["source"],
            url=item.get("url"),
            entities=item.get("entities", []),
            event_type=item.get("event_type", "general"),
            sentiment_score=item.get("sentiment_score"),
            volatility_score=item.get("volatility_score"),
            confidence=item.get("confidence"),
            raw_payload=item.get("raw_payload", {}),
        )
        db.add(event)
        created.append(event)

    db.commit()
    for e in created:
        db.refresh(e)
    return created


@router.get("/events", response_model=list[NewsEventOut])
def get_events(
    entity: Optional[str] = Query(None, description="Filter by entity/ticker"),
    event_type: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(NewsEvent).order_by(NewsEvent.captured_at.desc())
    if event_type:
        q = q.filter(NewsEvent.event_type == event_type)
    events = q.limit(limit).all()
    events = [e for e in events if _is_entity_match(e, entity)]
    events.sort(key=lambda e: (_event_rank(e), e.captured_at), reverse=True)
    return events


@router.post("/ingest", response_model=list[NewsEventOut])
async def ingest_news(
    entities: Optional[list[str]] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    portfolio_id = require_active_portfolio_id(user)
    if not entities:
        holdings_snapshot = await get_holdings_for_user(
            db=db,
            user_id=user.id,
            portfolio_id=portfolio_id,
        )
        entities = _news_entities_from_holdings(holdings_snapshot)
    try:
        items = await news_service.fetch_news(entities=entities)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return _ingest_items(db, items)


@router.get("/portfolio-impact", response_model=NewsPortfolioImpactOut)
async def get_portfolio_news_impact(
    entity: Optional[str] = Query(None, description="Filter by entity/ticker"),
    event_type: Optional[str] = Query(None),
    limit: int = Query(40, ge=1, le=120),
    refresh: bool = Query(False, description="Fetch latest headlines before scoring"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    portfolio_id = require_active_portfolio_id(user)
    holdings_snapshot = await get_holdings_for_user(
        db=db,
        user_id=user.id,
        portfolio_id=portfolio_id,
    )
    holdings = holdings_snapshot.holdings

    if refresh:
        try:
            entities = _news_entities_from_holdings(holdings_snapshot)
            if entity:
                entities.append(entity)
            items = await news_service.fetch_news(entities=entities or None)
            _ingest_items(db, items)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc))

    q = db.query(NewsEvent).order_by(NewsEvent.captured_at.desc())
    if event_type:
        q = q.filter(NewsEvent.event_type == event_type)
    rows = [e for e in q.limit(200).all() if _is_entity_match(e, entity)]

    event_impacts: list[dict] = []
    for row in rows:
        event_out = NewsEventOut.model_validate(row)
        impact = impact_for_event(event_out.model_dump(), holdings)
        event_impacts.append(
            {
                "event": event_out,
                "rank_score": impact["rank_score"],
                "portfolio_impact_score": impact["portfolio_impact_score"],
                "net_sentiment_impact": impact["net_sentiment_impact"],
                "impacted_holdings": [
                    HoldingImpactOut(**h) for h in impact["impacted_holdings"]
                ],
            }
        )

    event_impacts.sort(
        key=lambda e: (
            float(e["portfolio_impact_score"]),
            float(e["rank_score"]),
            e["event"].captured_at,
        ),
        reverse=True,
    )
    event_impacts = event_impacts[:limit]

    top_impacted = aggregate_top_impacted(
        [
            {
                "impacted_holdings": [h.model_dump() for h in e["impacted_holdings"]],
            }
            for e in event_impacts
        ],
        top_n=10,
    )

    return NewsPortfolioImpactOut(
        generated_at=datetime.now(tz=timezone.utc),
        events=[NewsEventImpactOut(**e) for e in event_impacts],
        top_impacted_holdings=[HoldingImpactOut(**h) for h in top_impacted],
    )
