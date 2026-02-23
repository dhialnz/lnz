from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.rulebook import Rulebook, DEFAULT_THRESHOLDS, DEFAULT_RULE_TEXT
from app.schemas.rulebook import RulebookOut, RulebookUpdate

router = APIRouter(prefix="/rulebook", tags=["rulebook"])


def _get_or_create(db: Session) -> Rulebook:
    rb = db.query(Rulebook).first()
    if rb is None:
        rb = Rulebook(thresholds=DEFAULT_THRESHOLDS.copy(), text=DEFAULT_RULE_TEXT)
        db.add(rb)
        db.commit()
        db.refresh(rb)
    return rb


@router.get("", response_model=RulebookOut)
def get_rulebook(db: Session = Depends(get_db)):
    return _get_or_create(db)


@router.put("", response_model=RulebookOut)
def update_rulebook(payload: RulebookUpdate, db: Session = Depends(get_db)):
    rb = _get_or_create(db)
    if payload.thresholds is not None:
        # Merge: keep existing keys not in payload
        merged = {**rb.thresholds, **payload.thresholds}
        rb.thresholds = merged
    if payload.text is not None:
        rb.text = payload.text
    db.commit()
    db.refresh(rb)
    return rb
