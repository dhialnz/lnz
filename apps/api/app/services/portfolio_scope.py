from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.portfolio_book import PortfolioBook
from app.models.user import User


DEFAULT_PORTFOLIO_NAME = "Main Portfolio"


def _ensure_unique_name(db: Session, user_id: uuid.UUID, base_name: str) -> str:
    existing = {
        row[0]
        for row in db.query(PortfolioBook.name)
        .filter(PortfolioBook.user_id == user_id)
        .all()
    }
    if base_name not in existing:
        return base_name
    i = 2
    while True:
        candidate = f"{base_name} {i}"
        if candidate not in existing:
            return candidate
        i += 1


def get_or_create_default_portfolio(db: Session, user: User) -> PortfolioBook:
    default = (
        db.query(PortfolioBook)
        .filter(PortfolioBook.user_id == user.id, PortfolioBook.is_default.is_(True))
        .order_by(PortfolioBook.created_at.asc())
        .first()
    )
    if default:
        return default
    name = _ensure_unique_name(db, user.id, DEFAULT_PORTFOLIO_NAME)
    default = PortfolioBook(user_id=user.id, name=name, is_default=True)
    db.add(default)
    db.flush()
    return default


def ensure_active_portfolio(db: Session, user: User) -> PortfolioBook:
    active: PortfolioBook | None = None
    if user.active_portfolio_id:
        active = (
            db.query(PortfolioBook)
            .filter(
                PortfolioBook.id == user.active_portfolio_id,
                PortfolioBook.user_id == user.id,
            )
            .first()
        )
    if active is None:
        active = get_or_create_default_portfolio(db, user)
        user.active_portfolio_id = active.id
        db.commit()
        db.refresh(user)
    return active


def require_active_portfolio_id(user: User) -> uuid.UUID:
    if not user.active_portfolio_id:
        raise HTTPException(status_code=500, detail="Active portfolio is not set.")
    return user.active_portfolio_id

