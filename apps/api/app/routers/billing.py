from __future__ import annotations

import logging
from typing import Literal

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services.auth_service import get_current_user

logger = logging.getLogger("lnz.billing")
router = APIRouter(prefix="/billing", tags=["billing"])


class CheckoutIn(BaseModel):
    tier: Literal["analyst", "command"]


def _price_id_for_tier(tier: str) -> str:
    if tier == "analyst":
        return settings.STRIPE_ANALYST_PRICE_ID
    if tier == "command":
        return settings.STRIPE_COMMAND_PRICE_ID
    return ""


def _tier_for_price_id(price_id: str | None) -> str:
    if not price_id:
        return "observer"
    if price_id == settings.STRIPE_COMMAND_PRICE_ID:
        return "command"
    if price_id == settings.STRIPE_ANALYST_PRICE_ID:
        return "analyst"
    return "observer"


def _require_stripe_enabled() -> None:
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe is not configured.")
    stripe.api_key = settings.STRIPE_SECRET_KEY


def _base_url_from_request(request: Request) -> str:
    configured = (settings.PUBLIC_APP_URL or "").strip().rstrip("/")
    if configured.startswith("http://") or configured.startswith("https://"):
        return configured

    origin = (request.headers.get("origin") or "").strip().rstrip("/")
    if origin.startswith("http://") or origin.startswith("https://"):
        return origin

    forwarded_host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
    host = (request.headers.get("host") or "").split(",")[0].strip()
    candidate_host = forwarded_host or host
    if candidate_host in {"api", "api:8000", "localhost:8000", "127.0.0.1:8000"}:
        candidate_host = "app.alphenzi.com"

    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").split(",")[0].strip()
    return f"{proto}://{(candidate_host or 'app.alphenzi.com')}".rstrip("/")


def _find_or_create_customer(user: User) -> str:
    # Prefer a targeted lookup by email when available.
    if user.email:
        customers = stripe.Customer.list(email=user.email, limit=20)
        for customer in customers.auto_paging_iter():
            metadata = (customer.get("metadata") or {})
            if metadata.get("clerk_id") == user.clerk_id:
                return str(customer.get("id"))

    # Fallback lookup by clerk_id metadata for users lacking email in local DB.
    customers = stripe.Customer.list(limit=100)
    for customer in customers.auto_paging_iter():
        metadata = (customer.get("metadata") or {})
        if metadata.get("clerk_id") == user.clerk_id:
            return str(customer.get("id"))

    create_payload = {
        "name": user.display_name,
        "metadata": {"clerk_id": user.clerk_id},
    }
    if user.email:
        create_payload["email"] = user.email

    created = stripe.Customer.create(**create_payload)
    return str(created.get("id"))


def _create_checkout_url(
    *,
    user: User,
    request: Request,
    tier: Literal["analyst", "command"],
) -> str:
    _require_stripe_enabled()

    price_id = _price_id_for_tier(tier)
    if not price_id:
        raise HTTPException(status_code=503, detail=f"Missing Stripe price id for tier '{tier}'.")

    try:
        customer_id = _find_or_create_customer(user)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Stripe customer lookup/create failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=(
                "Stripe customer lookup failed. Verify STRIPE_SECRET_KEY is valid "
                "for the current Stripe mode (test/live)."
            ),
        ) from exc
    base = _base_url_from_request(request)

    apply_analyst_trial = False
    trial_days = max(0, int(settings.STRIPE_ANALYST_TRIAL_DAYS or 0))
    if tier == "analyst" and trial_days > 0:
        try:
            prior_subs = stripe.Subscription.list(
                customer=customer_id,
                status="all",
                limit=1,
            )
            apply_analyst_trial = len((prior_subs or {}).get("data") or []) == 0
        except Exception:
            # Fail closed: no trial if Stripe subscription lookup fails.
            apply_analyst_trial = False

    subscription_data: dict = {"metadata": {"clerk_id": user.clerk_id}}
    if apply_analyst_trial:
        subscription_data["trial_period_days"] = trial_days

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[{"price": price_id, "quantity": 1}],
            allow_promotion_codes=True,
            client_reference_id=user.clerk_id,
            metadata={
                "clerk_id": user.clerk_id,
                "target_tier": tier,
                "analyst_trial_applied": "true" if apply_analyst_trial else "false",
            },
            subscription_data=subscription_data,
            success_url=f"{base}/billing/success",
            cancel_url=f"{base}/billing/cancel",
        )
    except Exception as exc:
        logger.exception("Stripe checkout create failed: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to create checkout session.") from exc

    url = session.get("url")
    if not url:
        raise HTTPException(status_code=502, detail="Stripe checkout did not return a URL.")
    return str(url)


def _create_portal_url(*, user: User, request: Request) -> str:
    _require_stripe_enabled()

    try:
        customer_id = _find_or_create_customer(user)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Stripe customer lookup/create failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=(
                "Stripe customer lookup failed. Verify STRIPE_SECRET_KEY is valid "
                "for the current Stripe mode (test/live)."
            ),
        ) from exc
    base = _base_url_from_request(request)
    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{base}/billing",
        )
    except Exception as exc:
        logger.exception("Stripe billing portal create failed: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to create billing portal session.") from exc

    url = session.get("url")
    if not url:
        raise HTTPException(status_code=502, detail="Stripe portal did not return a URL.")
    return str(url)


def _resolve_clerk_id_from_subscription(subscription: dict, db: Session) -> str | None:
    metadata = subscription.get("metadata") or {}
    clerk_id = metadata.get("clerk_id")
    if clerk_id:
        return str(clerk_id)

    customer_id = subscription.get("customer")
    if not customer_id:
        return None

    try:
        customer = stripe.Customer.retrieve(customer_id)
    except Exception:
        return None

    cust_metadata = (customer.get("metadata") or {}) if isinstance(customer, dict) else {}
    clerk_id = cust_metadata.get("clerk_id")
    if clerk_id:
        return str(clerk_id)

    email = customer.get("email") if isinstance(customer, dict) else None
    if not email:
        return None
    user = db.query(User).filter(User.email == email).first()
    return user.clerk_id if user else None


@router.post("/checkout")
def create_checkout_session(
    payload: CheckoutIn,
    request: Request,
    user: User = Depends(get_current_user),
) -> dict:
    url = _create_checkout_url(user=user, request=request, tier=payload.tier)
    return {"url": url}


@router.post("/portal")
def create_billing_portal_session(
    request: Request,
    user: User = Depends(get_current_user),
) -> dict:
    url = _create_portal_url(user=user, request=request)
    return {"url": url}


@router.get("/checkout-redirect")
def checkout_redirect(
    tier: Literal["analyst", "command"],
    request: Request,
    user: User = Depends(get_current_user),
) -> RedirectResponse:
    try:
        url = _create_checkout_url(user=user, request=request, tier=tier)
        return RedirectResponse(url=url, status_code=303)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected checkout redirect failure: %s", exc)
        raise HTTPException(status_code=502, detail=f"Checkout redirect failed: {exc}") from exc


@router.get("/portal-redirect")
def portal_redirect(
    request: Request,
    user: User = Depends(get_current_user),
) -> RedirectResponse:
    try:
        url = _create_portal_url(user=user, request=request)
        return RedirectResponse(url=url, status_code=303)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected portal redirect failure: %s", exc)
        raise HTTPException(status_code=502, detail=f"Portal redirect failed: {exc}") from exc


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
    stripe_signature: str | None = Header(None, alias="Stripe-Signature"),
) -> dict:
    _require_stripe_enabled()

    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Stripe webhook secret is not configured.")

    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=stripe_signature or "",
            secret=settings.STRIPE_WEBHOOK_SECRET,
        )
    except Exception as exc:
        logger.warning("Stripe webhook signature failed: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature.") from exc

    event_type = event.get("type")

    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        clerk_id = session.get("client_reference_id") or (session.get("metadata") or {}).get("clerk_id")
        tier = (session.get("metadata") or {}).get("target_tier")
        if clerk_id and tier in {"analyst", "command"}:
            user = db.query(User).filter(User.clerk_id == clerk_id).first()
            if user:
                user.tier = tier
                db.commit()
                logger.info("Billing tier updated from checkout: clerk_id=%s tier=%s", clerk_id, tier)

    elif event_type in {"customer.subscription.updated", "customer.subscription.deleted"}:
        subscription = event["data"]["object"]
        clerk_id = _resolve_clerk_id_from_subscription(subscription, db)
        if clerk_id:
            status = str(subscription.get("status") or "")
            tier = "observer"
            if event_type != "customer.subscription.deleted" and status in {
                "trialing",
                "active",
                "past_due",
            }:
                items = (subscription.get("items") or {}).get("data") or []
                price_id = None
                if items:
                    price_id = ((items[0] or {}).get("price") or {}).get("id")
                tier = _tier_for_price_id(price_id)

            user = db.query(User).filter(User.clerk_id == clerk_id).first()
            if user and user.tier != tier:
                user.tier = tier
                db.commit()
                logger.info(
                    "Billing tier updated from subscription event: clerk_id=%s status=%s tier=%s",
                    clerk_id,
                    status,
                    tier,
                )

    return {"status": "ok"}
