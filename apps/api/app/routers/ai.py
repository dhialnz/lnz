from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas.ai import (
    AIChatIn,
    AIChatOut,
    AIDashboardRecommendationsOut,
    AINewsSummaryOut,
    AIStatusOut,
    PortfolioInsightsOut,
)
from app.services.ai_advisor import (
    ai_is_enabled,
    build_ai_context,
    chat_with_portfolio,
    generate_dashboard_recommendations,
    generate_news_summary,
    generate_portfolio_insights,
    resolve_ai_provider,
)
from app.services.auth_service import get_current_user, require_analyst
from app.services.portfolio_scope import require_active_portfolio_id

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status", response_model=AIStatusOut)
def get_ai_status(user: User = Depends(get_current_user)) -> AIStatusOut:
    provider, model = resolve_ai_provider()
    return AIStatusOut(
        ai_enabled=ai_is_enabled(),
        provider=provider,
        model=model,
    )


@router.get("/portfolio-insights", response_model=PortfolioInsightsOut)
async def get_portfolio_insights(
    db: Session = Depends(get_db),
    user: User = Depends(require_analyst),
) -> PortfolioInsightsOut:
    portfolio_id = require_active_portfolio_id(user)
    context = await build_ai_context(db, user.id, portfolio_id)
    payload = await generate_portfolio_insights(context)
    return PortfolioInsightsOut(**payload)


@router.post("/chat", response_model=AIChatOut)
async def ai_chat(
    payload: AIChatIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_analyst),
) -> AIChatOut:
    portfolio_id = require_active_portfolio_id(user)
    context = await build_ai_context(db, user.id, portfolio_id)
    history = [m.model_dump() for m in payload.history]
    data = await chat_with_portfolio(context, payload.message, history)
    return AIChatOut(**data)


@router.get("/dashboard-recommendations", response_model=AIDashboardRecommendationsOut)
async def get_dashboard_recommendations(
    db: Session = Depends(get_db),
    user: User = Depends(require_analyst),
) -> AIDashboardRecommendationsOut:
    portfolio_id = require_active_portfolio_id(user)
    context = await build_ai_context(db, user.id, portfolio_id)
    payload = await generate_dashboard_recommendations(context)
    return AIDashboardRecommendationsOut(**payload)


@router.get("/news-summary", response_model=AINewsSummaryOut)
async def get_news_summary(
    db: Session = Depends(get_db),
    user: User = Depends(require_analyst),
) -> AINewsSummaryOut:
    portfolio_id = require_active_portfolio_id(user)
    context = await build_ai_context(db, user.id, portfolio_id)
    payload = await generate_news_summary(context)
    return AINewsSummaryOut(**payload)
