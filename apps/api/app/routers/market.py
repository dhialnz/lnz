from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.market import MarketSnapshot
from app.schemas.market import MarketSnapshotOut
from app.services import market_data

logger = logging.getLogger("lnz.market")

router = APIRouter(prefix="/market", tags=["market"])

_CNN_FG_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
_CNN_FG_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, */*",
    "Referer": "https://edition.cnn.com/",
}


def _to_optional_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@router.get("/snapshot", response_model=MarketSnapshotOut)
def get_snapshot(db: Session = Depends(get_db)):
    snap = db.query(MarketSnapshot).order_by(MarketSnapshot.captured_at.desc()).first()
    if not snap:
        raise HTTPException(status_code=404, detail="No market snapshot available. Run /market/refresh.")
    return snap


@router.post("/refresh", response_model=MarketSnapshotOut)
async def refresh_snapshot(db: Session = Depends(get_db)):
    try:
        payload = await market_data.fetch_snapshot()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    snap = MarketSnapshot(payload=payload)
    db.add(snap)
    db.commit()
    db.refresh(snap)
    return snap


@router.get("/fear-greed", summary="CNN Fear & Greed Index (proxied)")
async def get_fear_greed() -> dict:
    """Proxy CNN's Fear & Greed Index to avoid browser CORS restrictions."""
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            resp = await client.get(_CNN_FG_URL, headers=_CNN_FG_HEADERS)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.warning("CNN F&G API returned %s", exc.response.status_code)
        raise HTTPException(status_code=502, detail=f"CNN Fear & Greed API returned {exc.response.status_code}")
    except httpx.RequestError as exc:
        logger.warning("CNN F&G API request failed: %s", exc)
        raise HTTPException(status_code=502, detail="CNN Fear & Greed API unreachable")

    fg = data.get("fear_and_greed") or {}
    score = fg.get("score")
    if score is None:
        raise HTTPException(status_code=502, detail="Unexpected CNN Fear & Greed response format")
    try:
        score_value = float(score)
    except (TypeError, ValueError):
        raise HTTPException(status_code=502, detail="Unexpected CNN Fear & Greed score value")

    logger.info("F&G index fetched: score=%.1f rating=%s", score_value, fg.get("rating"))
    return {
        "score": score_value,
        "rating": fg.get("rating", "Unknown"),
        "previous_close": _to_optional_float(fg.get("previous_close")),
        "previous_1_week": _to_optional_float(fg.get("previous_1_week")),
        "previous_1_month": _to_optional_float(fg.get("previous_1_month")),
        "timestamp": fg.get("timestamp"),
    }
