from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.market import MarketSnapshot
from app.schemas.market import MarketSnapshotOut
from app.services import market_data

router = APIRouter(prefix="/market", tags=["market"])


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
