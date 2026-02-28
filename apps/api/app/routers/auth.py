from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.holdings import Holding
from app.models.portfolio import PortfolioImport, PortfolioSeries
from app.models.recommendations import Recommendation
from app.models.rulebook import Rulebook
from app.models.user import User
from app.services.auth_service import SYSTEM_UUID, get_current_user, require_admin

logger = logging.getLogger("lnz.auth")
router = APIRouter(prefix="/auth", tags=["auth"])

VALID_TIERS = {"observer", "analyst", "command"}

# Tables whose rows are reassigned to the first real admin on signup.
_OWNED_MODELS = [Holding, PortfolioSeries, PortfolioImport, Recommendation, Rulebook]


class SetTierIn(BaseModel):
    target_clerk_id: str
    tier: str


@router.get("/me")
def get_me(user: User = Depends(get_current_user)) -> dict:
    return {
        "clerk_id": user.clerk_id,
        "email": user.email,
        "display_name": user.display_name,
        "tier": user.tier,
        "is_admin": user.is_admin,
    }


@router.post("/webhook")
async def clerk_webhook(
    request: Request,
    db: Session = Depends(get_db),
    svix_id: str | None = Header(None, alias="svix-id"),
    svix_timestamp: str | None = Header(None, alias="svix-timestamp"),
    svix_signature: str | None = Header(None, alias="svix-signature"),
) -> dict:
    body = await request.body()

    # Verify Svix webhook signature when secret is configured.
    if settings.CLERK_WEBHOOK_SECRET:
        try:
            from svix.webhooks import Webhook  # type: ignore[import]

            wh = Webhook(settings.CLERK_WEBHOOK_SECRET)
            headers = {
                "svix-id": svix_id or "",
                "svix-timestamp": svix_timestamp or "",
                "svix-signature": svix_signature or "",
            }
            wh.verify(body, headers)
        except Exception as exc:
            logger.warning("Webhook signature verification failed: %s", exc)
            raise HTTPException(status_code=400, detail="Invalid webhook signature.")

    try:
        event = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook payload.") from exc
    event_type = event.get("type")
    data = event.get("data", {})

    if event_type == "user.created":
        clerk_id = data.get("id", "")
        email_addrs = data.get("email_addresses") or []
        email = email_addrs[0].get("email_address") if email_addrs else None
        first = (data.get("first_name") or "").strip()
        last = (data.get("last_name") or "").strip()
        display_name = f"{first} {last}".strip() or None

        existing = db.query(User).filter(User.clerk_id == clerk_id).first()
        if existing:
            # Idempotent replay: update profile fields and return success.
            existing.email = email
            existing.display_name = display_name
            db.commit()
            logger.info("Webhook replay user.created ignored: clerk_id=%s", clerk_id)
            return {"status": "ok", "idempotent": True}

        # If no real users exist yet (only SYSTEM placeholder), this is the admin.
        real_user_count = db.query(User).filter(User.clerk_id != "SYSTEM").count()
        is_first_admin = real_user_count == 0

        new_user = User(
            clerk_id=clerk_id,
            email=email,
            display_name=display_name,
            tier="command" if is_first_admin else "observer",
            is_admin=is_first_admin,
        )
        db.add(new_user)
        db.flush()  # Assigns new_user.id without committing yet.

        if is_first_admin:
            # Reassign all legacy data from SYSTEM placeholder to this admin.
            for model in _OWNED_MODELS:
                db.query(model).filter(model.user_id == SYSTEM_UUID).update(
                    {"user_id": new_user.id}, synchronize_session=False
                )
            logger.info(
                "First admin created: clerk_id=%s email=%s. Legacy data reassigned.",
                clerk_id,
                email,
            )
        else:
            logger.info("New user created: clerk_id=%s email=%s tier=observer", clerk_id, email)

        try:
            db.commit()
        except IntegrityError:
            # Safe fallback for concurrent delivery races.
            db.rollback()
            logger.info("Webhook race ignored for clerk_id=%s", clerk_id)
            return {"status": "ok", "idempotent": True}

    elif event_type == "user.updated":
        clerk_id = data.get("id", "")
        user = db.query(User).filter(User.clerk_id == clerk_id).first()
        if user:
            email_addrs = data.get("email_addresses") or []
            email = email_addrs[0].get("email_address") if email_addrs else None
            first = (data.get("first_name") or "").strip()
            last = (data.get("last_name") or "").strip()
            user.email = email
            user.display_name = f"{first} {last}".strip() or None
            db.commit()
            logger.info("User updated from webhook: clerk_id=%s", clerk_id)

    elif event_type == "user.deleted":
        clerk_id = data.get("id", "")
        user = db.query(User).filter(User.clerk_id == clerk_id).first()
        if user:
            db.delete(user)
            db.commit()
            logger.info("User deleted: clerk_id=%s", clerk_id)

    return {"status": "ok"}


@router.patch("/admin/set-tier")
def set_tier(
    payload: SetTierIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    if payload.tier not in VALID_TIERS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid tier '{payload.tier}'. Must be one of: {sorted(VALID_TIERS)}",
        )
    target = db.query(User).filter(User.clerk_id == payload.target_clerk_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    target.tier = payload.tier
    db.commit()
    logger.info(
        "Admin %s set %s tier to %s", admin.clerk_id, target.clerk_id, payload.tier
    )
    return {"clerk_id": target.clerk_id, "tier": target.tier}
