from __future__ import annotations

import datetime as dt
import logging
import math
import re
import uuid

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.holdings import Holding
from app.models.user import User
from app.schemas.holdings import (
    HoldingIn,
    HoldingLive,
    HoldingOut,
    HoldingsSnapshot,
    SparklinePoint,
    TickerSuggestion,
)
from app.services import yahoo_quotes
from app.services.auth_service import get_current_user
from app.services.portfolio_scope import require_active_portfolio_id

router = APIRouter(prefix="/holdings", tags=["holdings"])
logger = logging.getLogger("lnz.holdings")

# Ticker must be 1-6 uppercase letters/digits optionally followed by .XX exchange suffix.
_VALID_TICKER = re.compile(r"^[A-Z0-9]{1,6}(\.[A-Z]{1,3})?$")

_RISK_FREE_ANNUAL = 0.045  # 4.5% annualised risk-free rate
_OBSERVER_HOLDINGS_LIMIT = 5


def _safe_float(val) -> float | None:
    if val is None:
        return None
    try:
        f = float(val)
        return None if not math.isfinite(f) else f
    except (TypeError, ValueError):
        return None


def _cost_per_share_usd(
    avg_cost_per_share: float,
    avg_cost_currency: str,
    usd_per_cad: float | None,
) -> float | None:
    if avg_cost_currency == "USD":
        return avg_cost_per_share
    if avg_cost_currency == "CAD":
        # Fallback to raw value if FX is unavailable to keep snapshot responsive.
        if usd_per_cad is None:
            return avg_cost_per_share
        return avg_cost_per_share * usd_per_cad
    return None


def _quote_to_usd(
    amount: float | None, quote_currency: str, usd_per_cad: float | None
) -> float | None:
    if amount is None:
        return None
    if quote_currency == "USD":
        return amount
    if quote_currency == "CAD":
        if usd_per_cad is None:
            return amount
        return amount * usd_per_cad
    return amount


def _period_change_from_history(
    *,
    shares: float,
    current_price: float | None,
    history_usd: list[float],
    lookback_points: int,
) -> tuple[float | None, float | None, float | None]:
    """
    Returns (change_amount, change_pct, prior_total_value).
    lookback_points uses trading-day count (e.g., 5, 21, 252).
    """
    if current_price is None:
        return None, None, None
    if len(history_usd) <= lookback_points:
        return None, None, None
    prior_close = history_usd[-(lookback_points + 1)]
    if prior_close is None or prior_close == 0:
        return None, None, None
    change_pct = (current_price / prior_close) - 1.0
    change_amount = shares * (current_price - prior_close)
    prior_total = shares * prior_close
    return change_amount, change_pct, prior_total


def _portfolio_daily_returns(
    holdings_live: list[HoldingLive],
    total_value: float,
) -> list[float]:
    """Build a portfolio-level daily return series from aligned holding sparklines."""
    if total_value <= 0:
        return []

    priced = [h for h in holdings_live if h.current_price is not None and h.total_value is not None and h.sparkline]
    if not priced:
        return []

    # Build a dict of {date: {ticker: close}} aligned across priced tickers.
    date_closes: dict[str, dict[str, float]] = {}
    for h in priced:
        for pt in h.sparkline:
            date_closes.setdefault(pt.date, {})[h.ticker] = pt.close

    # Need at least 5 common dates
    common_dates = sorted(d for d, tickers in date_closes.items() if len(tickers) == len(priced))
    if len(common_dates) < 5:
        return []

    # Compute daily portfolio returns.
    portfolio_returns: list[float] = []
    prev_date = None
    for d in common_dates:
        if prev_date is None:
            prev_date = d
            continue
        prev_closes = date_closes[prev_date]
        curr_closes = date_closes[d]
        daily_ret = 0.0
        for h in priced:
            weight = h.total_value / total_value
            pc = prev_closes.get(h.ticker)
            cc = curr_closes.get(h.ticker)
            if pc and cc and pc != 0:
                daily_ret += weight * ((cc / pc) - 1.0)
        portfolio_returns.append(daily_ret)
        prev_date = d
    return portfolio_returns


def _compute_portfolio_risk_metrics(
    daily_returns: list[float],
) -> tuple[float | None, float | None]:
    """Compute annualised Sharpe and Sortino from portfolio daily returns."""
    if len(daily_returns) < 4:
        return None, None

    returns_arr = np.array(daily_returns)
    rf_daily = _RISK_FREE_ANNUAL / 252
    excess = returns_arr - rf_daily
    mean_excess = float(np.mean(excess))
    std_all = float(np.std(returns_arr, ddof=1))

    if std_all == 0:
        return None, None

    sharpe = mean_excess / std_all * math.sqrt(252)

    downside = returns_arr[returns_arr < rf_daily]
    if len(downside) < 2:
        sortino = None
    else:
        std_down = float(np.std(downside, ddof=1))
        sortino = mean_excess / std_down * math.sqrt(252) if std_down > 0 else None

    return (
        round(sharpe, 4) if math.isfinite(sharpe) else None,
        round(sortino, 4) if sortino is not None and math.isfinite(sortino) else None,
    )


def _compute_portfolio_extended_metrics(
    daily_returns: list[float],
) -> tuple[float | None, float | None, float | None, float | None, float | None]:
    """
    Returns (profit_factor, cagr, r_expectancy, mae, mfe) from daily return series.
    All return-based metrics are decimals (e.g., 0.12 = 12%).
    """
    if not daily_returns:
        return None, None, None, None, None

    arr = np.array(daily_returns, dtype=float)
    pos = arr[arr > 0]
    neg = arr[arr < 0]

    # Profit factor = gross gains / gross losses(abs)
    gross_profit = float(np.sum(pos)) if len(pos) else 0.0
    gross_loss_abs = abs(float(np.sum(neg))) if len(neg) else 0.0
    profit_factor = (gross_profit / gross_loss_abs) if gross_loss_abs > 0 else None

    # CAGR from cumulative growth over the observed daily return window.
    growth = float(np.prod(1.0 + arr))
    periods = len(arr)
    cagr = None
    if periods > 0 and growth > 0:
        cagr_raw = growth ** (252 / periods) - 1.0
        cagr = cagr_raw if math.isfinite(cagr_raw) else None

    # R-expectancy in R-multiples where average losing day magnitude = 1R.
    r_expectancy = None
    if len(pos) and len(neg):
        avg_win = float(np.mean(pos))
        avg_loss_abs = abs(float(np.mean(neg)))
        if avg_loss_abs > 0:
            win_rate = len(pos) / periods
            loss_rate = len(neg) / periods
            r_raw = (win_rate * (avg_win / avg_loss_abs)) - loss_rate
            r_expectancy = r_raw if math.isfinite(r_raw) else None

    mae = float(np.min(arr)) if len(arr) else None
    mfe = float(np.max(arr)) if len(arr) else None

    return (
        round(profit_factor, 4) if profit_factor is not None else None,
        round(cagr, 4) if cagr is not None else None,
        round(r_expectancy, 4) if r_expectancy is not None else None,
        round(mae, 4) if mae is not None and math.isfinite(mae) else None,
        round(mfe, 4) if mfe is not None and math.isfinite(mfe) else None,
    )


async def get_holdings_for_user(
    db: Session,
    user_id: uuid.UUID,
    portfolio_id: uuid.UUID,
) -> HoldingsSnapshot:
    """Core holdings logic — callable directly from ai_advisor without FastAPI DI."""
    rows = (
        db.query(Holding)
        .filter(Holding.user_id == user_id, Holding.portfolio_id == portfolio_id)
        .order_by(Holding.added_at)
        .all()
    )

    if not rows:
        return HoldingsSnapshot(
            holdings=[],
            total_cost_basis=0.0,
            total_value=None,
            total_unrealized_pnl=None,
            total_unrealized_pnl_pct=None,
            total_day_change=None,
            total_day_change_pct=None,
            total_week_change=None,
            total_week_change_pct=None,
            total_month_change=None,
            total_month_change_pct=None,
            total_year_change=None,
            total_year_change_pct=None,
            sharpe_30d=None,
            sortino_30d=None,
            profit_factor=None,
            cagr=None,
            r_expectancy=None,
            mae=None,
            mfe=None,
            as_of=dt.datetime.utcnow().isoformat() + "Z",
        )

    tickers = [r.ticker for r in rows]
    quote_map = await yahoo_quotes.fetch_all_tickers(tickers, history_range="1y")
    usd_per_cad = await yahoo_quotes.fetch_usd_per_cad()

    if usd_per_cad is None:
        logger.warning(
            "FX rate unavailable — CAD holdings will use raw CAD cost as fallback. "
            "Values may be slightly inaccurate until FX recovers."
        )
    cad_holdings = [r.ticker for r in rows if (r.avg_cost_currency or "USD").upper() == "CAD"]
    if cad_holdings and usd_per_cad is None:
        logger.warning("CAD holdings affected by missing FX: %s", cad_holdings)

    holdings_live: list[HoldingLive] = []
    week_changes: list[float] = []
    week_prev_totals: list[float] = []
    month_changes: list[float] = []
    month_prev_totals: list[float] = []
    year_changes: list[float] = []
    year_prev_totals: list[float] = []
    for row in rows:
        q = quote_map.get(row.ticker)
        shares = float(row.shares)
        avg_cost = float(row.avg_cost_per_share)
        avg_cost_currency = (row.avg_cost_currency or "USD").upper()
        avg_cost_usd = _cost_per_share_usd(avg_cost, avg_cost_currency, usd_per_cad)
        total_cost = shares * avg_cost_usd if avg_cost_usd is not None else 0.0
        quote_currency = ((q or {}).get("quote_currency") or "USD").upper()

        current_price_raw = _safe_float(q.get("current_price")) if q else None
        day_change_raw = _safe_float(q.get("day_change")) if q else None
        current_price = _quote_to_usd(current_price_raw, quote_currency, usd_per_cad)
        day_change = _quote_to_usd(day_change_raw, quote_currency, usd_per_cad)
        day_change_pct = _safe_float(q.get("day_change_pct")) if q else None
        name = (q.get("name") or row.name or row.ticker) if q else (row.name or row.ticker)

        total_value: float | None = None
        unrealized_pnl: float | None = None
        unrealized_pnl_pct: float | None = None
        if current_price is not None:
            total_value = shares * current_price
            unrealized_pnl = total_value - total_cost
            unrealized_pnl_pct = unrealized_pnl / total_cost if total_cost != 0 else None

        history_usd: list[float] = []
        sparkline_raw: list[SparklinePoint] = []
        if q:
            for pt in q.get("history") or []:
                raw_close = _safe_float(pt.get("close"))
                if raw_close is None:
                    continue
                close_usd = _quote_to_usd(raw_close, quote_currency, usd_per_cad)
                if close_usd is None:
                    continue
                history_usd.append(close_usd)
                sparkline_raw.append(
                    SparklinePoint(
                        date=str(pt.get("date")),
                        close=close_usd,
                    )
                )
        # Keep sparkline dense but bounded for UI rendering.
        sparkline = sparkline_raw[-30:]

        week_change, week_change_pct, week_prior_total = _period_change_from_history(
            shares=shares,
            current_price=current_price,
            history_usd=history_usd,
            lookback_points=5,
        )
        month_change, month_change_pct, month_prior_total = _period_change_from_history(
            shares=shares,
            current_price=current_price,
            history_usd=history_usd,
            lookback_points=21,
        )
        year_change, year_change_pct, year_prior_total = _period_change_from_history(
            shares=shares,
            current_price=current_price,
            history_usd=history_usd,
            lookback_points=252,
        )

        if week_change is not None and week_prior_total is not None:
            week_changes.append(week_change)
            week_prev_totals.append(week_prior_total)
        if month_change is not None and month_prior_total is not None:
            month_changes.append(month_change)
            month_prev_totals.append(month_prior_total)
        if year_change is not None and year_prior_total is not None:
            year_changes.append(year_change)
            year_prev_totals.append(year_prior_total)

        holdings_live.append(
            HoldingLive(
                id=row.id,
                ticker=row.ticker,
                name=name,
                shares=shares,
                avg_cost_per_share=avg_cost,
                avg_cost_currency=avg_cost_currency,
                avg_cost_per_share_usd=avg_cost_usd,
                notes=row.notes,
                added_at=row.added_at,
                current_price=current_price,
                day_change=day_change,
                day_change_pct=day_change_pct,
                week_change=week_change,
                week_change_pct=week_change_pct,
                month_change=month_change,
                month_change_pct=month_change_pct,
                year_change=year_change,
                year_change_pct=year_change_pct,
                total_cost_basis=total_cost,
                total_value=total_value,
                unrealized_pnl=unrealized_pnl,
                unrealized_pnl_pct=unrealized_pnl_pct,
                weight=None,  # set after total_value is computed
                sparkline=sparkline,
            )
        )

    # Compute portfolio totals
    total_cost_basis = sum(h.total_cost_basis for h in holdings_live)
    values_known = [h.total_value for h in holdings_live if h.total_value is not None]
    total_value_portfolio = sum(values_known) if values_known else None

    # Set weights
    for h in holdings_live:
        if total_value_portfolio and h.total_value is not None and total_value_portfolio > 0:
            h.weight = h.total_value / total_value_portfolio
        else:
            h.weight = None

    # Total day change
    total_day_change: float | None = None
    total_day_change_pct: float | None = None
    day_changes = [
        (float(h.shares) * h.day_change)
        for h in holdings_live
        if h.day_change is not None
    ]
    if day_changes:
        total_day_change = sum(day_changes)
        # day_change_pct relative to previous total value
        prev_total = sum(
            float(h.shares) * (h.current_price - h.day_change)
            for h in holdings_live
            if h.current_price is not None and h.day_change is not None
        )
        if prev_total and prev_total != 0:
            total_day_change_pct = total_day_change / prev_total

    total_week_change: float | None = None
    total_week_change_pct: float | None = None
    if week_changes and week_prev_totals:
        total_week_change = sum(week_changes)
        week_prev_total = sum(week_prev_totals)
        if week_prev_total != 0:
            total_week_change_pct = total_week_change / week_prev_total

    total_month_change: float | None = None
    total_month_change_pct: float | None = None
    if month_changes and month_prev_totals:
        total_month_change = sum(month_changes)
        month_prev_total = sum(month_prev_totals)
        if month_prev_total != 0:
            total_month_change_pct = total_month_change / month_prev_total

    total_year_change: float | None = None
    total_year_change_pct: float | None = None
    if year_changes and year_prev_totals:
        total_year_change = sum(year_changes)
        year_prev_total = sum(year_prev_totals)
        if year_prev_total != 0:
            total_year_change_pct = total_year_change / year_prev_total

    # Total unrealized P&L
    pnls = [h.unrealized_pnl for h in holdings_live if h.unrealized_pnl is not None]
    total_unrealized_pnl = sum(pnls) if pnls else None
    total_unrealized_pnl_pct = (
        total_unrealized_pnl / total_cost_basis
        if total_unrealized_pnl is not None and total_cost_basis != 0
        else None
    )

    # Portfolio risk/quality metrics from aligned daily return series.
    sharpe, sortino = (None, None)
    profit_factor, cagr, r_expectancy, mae, mfe = (None, None, None, None, None)
    if total_value_portfolio:
        daily_returns = _portfolio_daily_returns(holdings_live, total_value_portfolio)
        sharpe, sortino = _compute_portfolio_risk_metrics(daily_returns)
        profit_factor, cagr, r_expectancy, mae, mfe = _compute_portfolio_extended_metrics(
            daily_returns
        )

    return HoldingsSnapshot(
        holdings=holdings_live,
        total_cost_basis=total_cost_basis,
        total_value=total_value_portfolio,
        total_unrealized_pnl=total_unrealized_pnl,
        total_unrealized_pnl_pct=total_unrealized_pnl_pct,
        total_day_change=total_day_change,
        total_day_change_pct=total_day_change_pct,
        total_week_change=total_week_change,
        total_week_change_pct=total_week_change_pct,
        total_month_change=total_month_change,
        total_month_change_pct=total_month_change_pct,
        total_year_change=total_year_change,
        total_year_change_pct=total_year_change_pct,
        sharpe_30d=sharpe,
        sortino_30d=sortino,
        profit_factor=profit_factor,
        cagr=cagr,
        r_expectancy=r_expectancy,
        mae=mae,
        mfe=mfe,
        fx_warning=bool(cad_holdings) and usd_per_cad is None,
        as_of=dt.datetime.utcnow().isoformat() + "Z",
    )


@router.get("", response_model=HoldingsSnapshot)
async def get_holdings(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HoldingsSnapshot:
    portfolio_id = require_active_portfolio_id(user)
    return await get_holdings_for_user(db, user.id, portfolio_id)


@router.get("/ticker-suggestions", response_model=list[TickerSuggestion])
async def ticker_suggestions(q: str, limit: int = 8) -> list[TickerSuggestion]:
    query = (q or "").strip()
    if not query:
        return []
    results = await yahoo_quotes.search_tickers(query, limit=limit)
    return [
        TickerSuggestion(
            symbol=str(r.get("symbol") or "").upper(),
            name=r.get("name"),
            exchange=r.get("exchange"),
            quote_type=r.get("quote_type"),
        )
        for r in results
        if r.get("symbol")
    ]


def _validate_ticker(ticker: str) -> str:
    """Normalise and validate a ticker symbol. Raises HTTPException on invalid input."""
    normalised = ticker.strip().upper()
    if not normalised or not _VALID_TICKER.match(normalised):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid ticker format: '{ticker}'. Expected 1-6 uppercase letters/digits with optional .XX suffix.",
        )
    if len(normalised) < 1 or len(normalised) > 10:
        raise HTTPException(status_code=422, detail="Ticker must be 1–10 characters.")
    return normalised


@router.post("", response_model=HoldingOut, status_code=201)
async def add_holding(
    payload: HoldingIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HoldingOut:
    portfolio_id = require_active_portfolio_id(user)
    ticker = _validate_ticker(payload.ticker)
    if payload.shares <= 0:
        raise HTTPException(status_code=422, detail="Shares must be > 0.")
    if payload.avg_cost_per_share <= 0:
        raise HTTPException(status_code=422, detail="Average cost per share must be > 0.")
    if user.tier == "observer":
        current_count = (
            db.query(Holding)
            .filter(Holding.user_id == user.id, Holding.portfolio_id == portfolio_id)
            .count()
        )
        if current_count >= _OBSERVER_HOLDINGS_LIMIT:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Observer tier allows up to {_OBSERVER_HOLDINGS_LIMIT} holdings per portfolio. "
                    "Upgrade to Analyst or Command to add more."
                ),
            )

    # Optionally fetch name from Yahoo at add time.
    q = await yahoo_quotes.fetch_ticker_data(ticker)
    if q is None:
        logger.warning(
            "Could not validate ticker '%s' against Yahoo Finance on add — proceeding anyway.",
            ticker,
        )
    name = q.get("name") if q else None

    holding = Holding(
        user_id=user.id,
        portfolio_id=portfolio_id,
        ticker=ticker,
        name=name,
        shares=payload.shares,
        avg_cost_per_share=payload.avg_cost_per_share,
        avg_cost_currency=payload.avg_cost_currency,
        notes=payload.notes,
    )
    db.add(holding)
    db.commit()
    db.refresh(holding)
    logger.info("Holding added: user=%s ticker=%s shares=%s", user.clerk_id, ticker, payload.shares)
    return holding


@router.put("/{holding_id}", response_model=HoldingOut)
def update_holding(
    holding_id: uuid.UUID,
    payload: HoldingIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HoldingOut:
    portfolio_id = require_active_portfolio_id(user)
    ticker = _validate_ticker(payload.ticker)
    if payload.shares <= 0:
        raise HTTPException(status_code=422, detail="Shares must be > 0.")
    if payload.avg_cost_per_share <= 0:
        raise HTTPException(status_code=422, detail="Average cost per share must be > 0.")

    row = db.query(Holding).filter(
        Holding.id == holding_id,
        Holding.user_id == user.id,
        Holding.portfolio_id == portfolio_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Holding not found.")
    row.ticker = ticker
    row.shares = payload.shares
    row.avg_cost_per_share = payload.avg_cost_per_share
    row.avg_cost_currency = payload.avg_cost_currency
    row.notes = payload.notes
    db.commit()
    db.refresh(row)
    logger.info("Holding updated: user=%s id=%s ticker=%s", user.clerk_id, holding_id, ticker)
    return row


@router.delete("/{holding_id}")
def delete_holding(
    holding_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    portfolio_id = require_active_portfolio_id(user)
    row = db.query(Holding).filter(
        Holding.id == holding_id,
        Holding.user_id == user.id,
        Holding.portfolio_id == portfolio_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Holding not found.")
    db.delete(row)
    db.commit()
    return {"deleted": True}
