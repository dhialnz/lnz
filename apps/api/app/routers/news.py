from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.market import NewsEvent
from app.schemas.market import NewsEventOut
from app.services import news as news_service

router = APIRouter(prefix="/news", tags=["news"])


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

    if entity:
        events = [e for e in events if entity in (e.entities or [])]

    return events


@router.post("/ingest", response_model=list[NewsEventOut])
async def ingest_news(
    entities: Optional[list[str]] = None,
    db: Session = Depends(get_db),
):
    try:
        items = await news_service.fetch_news(entities=entities)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    created = []
    for item in items:
        event = NewsEvent(
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
