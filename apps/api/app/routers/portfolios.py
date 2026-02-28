from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.portfolio_book import PortfolioBook
from app.models.user import User
from app.schemas.portfolios import PortfolioActivateOut, PortfolioCreateIn, PortfolioOut
from app.services.auth_service import get_current_user, require_command
from app.services.portfolio_scope import (
    ensure_active_portfolio,
    get_or_create_default_portfolio,
)

router = APIRouter(prefix="/portfolios", tags=["portfolios"])


@router.get("", response_model=list[PortfolioOut])
def list_portfolios(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    active = ensure_active_portfolio(db, user)
    rows = (
        db.query(PortfolioBook)
        .filter(PortfolioBook.user_id == user.id)
        .order_by(PortfolioBook.created_at.asc())
        .all()
    )

    # Free/analyst tiers remain single-portfolio in this release.
    if user.tier != "command":
        rows = [r for r in rows if r.id == active.id] or [active]

    return [
        PortfolioOut(
            id=r.id,
            name=r.name,
            is_default=bool(r.is_default),
            is_active=r.id == user.active_portfolio_id,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("", response_model=PortfolioOut, status_code=201)
def create_portfolio(
    payload: PortfolioCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_command),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Portfolio name cannot be empty.")

    # Make sure default exists before adding additional portfolios.
    ensure_active_portfolio(db, user)

    row = PortfolioBook(user_id=user.id, name=name, is_default=False)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Portfolio name already exists.")
    db.refresh(row)
    return PortfolioOut(
        id=row.id,
        name=row.name,
        is_default=bool(row.is_default),
        is_active=row.id == user.active_portfolio_id,
        created_at=row.created_at,
    )


@router.post("/{portfolio_id}/activate", response_model=PortfolioActivateOut)
def activate_portfolio(
    portfolio_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_command),
):
    row = (
        db.query(PortfolioBook)
        .filter(PortfolioBook.id == portfolio_id, PortfolioBook.user_id == user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    user.active_portfolio_id = row.id
    db.commit()
    return PortfolioActivateOut(active_portfolio_id=row.id)


@router.delete("/{portfolio_id}")
def delete_portfolio(
    portfolio_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_command),
) -> dict:
    row = (
        db.query(PortfolioBook)
        .filter(PortfolioBook.id == portfolio_id, PortfolioBook.user_id == user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    if row.is_default:
        raise HTTPException(status_code=409, detail="Default portfolio cannot be deleted.")
    if user.active_portfolio_id == row.id:
        raise HTTPException(
            status_code=409,
            detail="Activate another portfolio before deleting this one.",
        )

    db.delete(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                "Portfolio still has dependent data. Clear its holdings/series/recommendations "
                "before deleting it."
            ),
        )

    # Safety: if deletion left user without default (unexpected legacy state), recreate one.
    get_or_create_default_portfolio(db, user)
    db.commit()
    return {"deleted": True}
