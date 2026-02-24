from __future__ import annotations

import math
import os
from datetime import timedelta
from io import BytesIO
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.portfolio import PortfolioImport, PortfolioSeries
from app.models.rulebook import Rulebook
from app.models.recommendations import Recommendation
from app.schemas.portfolio import (
    ClearImportedDataResult,
    ImportResult,
    ManualWeekEntryIn,
    ManualWeekEntryResult,
    ParsePreview,
    PortfolioSeriesRow,
    PortfolioSummary,
    SpyHistorySyncResult,
)
from app.services import excel_parser, metrics, regime, rules
from app.utils.crypto import encrypt_file

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


def _safe_val(val):
    """Convert NaN/Inf to None and numpy scalars to Python native types."""
    if val is None:
        return None
    if hasattr(val, "item"):
        val = val.item()
    if isinstance(val, float) and not math.isfinite(val):
        return None
    return val


def _get_or_create_rulebook(db: Session) -> Rulebook:
    rb = db.query(Rulebook).first()
    if rb is None:
        rb = Rulebook()
        db.add(rb)
        db.commit()
        db.refresh(rb)
    return rb


def _fetch_spy_closes_for_dates(target_dates) -> dict:
    """
    Fetch SPY closes directly from Yahoo Finance for a set of dates in one request.
    Raises ValueError when any requested date has no close value.
    """
    import datetime as dt

    dates = sorted(set(target_dates))
    if not dates:
        return {}

    start = int(dt.datetime.combine(dates[0], dt.time.min, tzinfo=dt.timezone.utc).timestamp())
    end = int((dt.datetime.combine(dates[-1], dt.time.min, tzinfo=dt.timezone.utc) + dt.timedelta(days=1)).timestamp())
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/SPY"
        f"?interval=1d&period1={start}&period2={end}"
    )
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; LNZ/1.0; +http://localhost)",
        "Accept": "application/json",
    }

    try:
        resp = httpx.get(url, headers=headers, timeout=10.0)
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:
        raise RuntimeError(f"Yahoo Finance fetch failed: {exc}") from exc

    try:
        result = payload["chart"]["result"][0]
        timestamps = result["timestamp"]
        closes = result["indicators"]["quote"][0]["close"]
    except Exception as exc:
        raise ValueError("No SPY close data found for requested date(s).") from exc

    close_by_date = {}
    for ts, close in zip(timestamps, closes):
        if close is None:
            continue
        d = dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).date()
        close_by_date[d] = float(close)

    missing = [str(d) for d in dates if d not in close_by_date]
    if missing:
        raise ValueError(f"No SPY close data found for date(s): {', '.join(missing)}")

    return {d: close_by_date[d] for d in dates}


def _fetch_spy_close_map_for_date_range(start_date, end_date) -> dict:
    """Fetch a daily SPY close map for [start_date, end_date]."""
    import datetime as dt

    start = int(dt.datetime.combine(start_date, dt.time.min, tzinfo=dt.timezone.utc).timestamp())
    end = int((dt.datetime.combine(end_date, dt.time.min, tzinfo=dt.timezone.utc) + dt.timedelta(days=1)).timestamp())
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/SPY"
        f"?interval=1d&period1={start}&period2={end}"
    )
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; LNZ/1.0; +http://localhost)",
        "Accept": "application/json",
    }

    try:
        resp = httpx.get(url, headers=headers, timeout=10.0)
        resp.raise_for_status()
        payload = resp.json()
        result = payload["chart"]["result"][0]
        timestamps = result["timestamp"]
        closes = result["indicators"]["quote"][0]["close"]
    except Exception as exc:
        raise RuntimeError(f"Yahoo Finance fetch failed: {exc}") from exc

    close_map = {}
    for ts, close in zip(timestamps, closes):
        if close is None:
            continue
        d = dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).date()
        close_map[d] = float(close)
    return close_map


def _sync_spy_history_and_recompute(db: Session) -> int:
    """Backfill spy_close, recompute benchmark_return from closes, and recompute all derived metrics."""
    import pandas as pd

    rows = db.query(PortfolioSeries).order_by(PortfolioSeries.date).all()
    if len(rows) < 2:
        return 0

    try:
        close_map = _fetch_spy_close_map_for_date_range(rows[0].date - timedelta(days=7), rows[-1].date)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    trade_dates = sorted(close_map.keys())
    if not trade_dates:
        raise HTTPException(status_code=422, detail="No SPY close data returned for the portfolio date range.")

    def close_on_or_before(target_date):
        for d in reversed(trade_dates):
            if d <= target_date:
                return close_map[d]
        return None

    built = []
    for r in rows:
        c = close_on_or_before(r.date)
        if c is None:
            raise HTTPException(status_code=422, detail=f"No SPY close available on or before {r.date}.")
        built.append(
            {
                "date": r.date,
                "total_value": float(r.total_value),
                "net_deposits": float(r.net_deposits),
                "period_deposits": float(r.period_deposits),
                "spy_close": float(c),
                "period_return": float(r.period_return),
                "benchmark_return": float(r.benchmark_return),
            }
        )

    df = pd.DataFrame(built).sort_values("date").reset_index(drop=True)
    for i in range(1, len(df)):
        prev_close = float(df.loc[i - 1, "spy_close"])
        curr_close = float(df.loc[i, "spy_close"])
        df.loc[i, "benchmark_return"] = (curr_close / prev_close) - 1.0

    # Keep first benchmark_return as existing imported baseline, then recompute all derived metrics.
    df = metrics.compute_weekly_series(df)

    existing_by_date = {r.date: r for r in rows}
    for _, row in df.iterrows():
        existing = existing_by_date.get(row["date"])
        if not existing:
            continue
        for col in [
            "total_value", "net_deposits", "period_deposits",
            "spy_close", "period_return", "benchmark_return",
            "alpha", "cumulative_alpha", "rolling_4w_alpha",
            "rolling_8w_vol", "rolling_8w_alpha_vol",
            "running_peak", "drawdown", "beta_12w",
        ]:
            setattr(existing, col, _safe_val(row.get(col)))
    db.commit()
    return len(df)


@router.post("/import-excel", response_model=ImportResult)
async def import_excel(
    file: UploadFile = File(...),
    dayfirst: bool = Form(False),
    db: Session = Depends(get_db),
):
    # Validate file type and size
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are accepted.")

    content = await file.read()
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit.",
        )

    # Parse
    try:
        df, parse_errors = excel_parser.parse_excel(content, dayfirst=dayfirst)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Compute metrics
    df = metrics.compute_weekly_series(df)
    if "spy_close" not in df.columns:
        df["spy_close"] = None

    # Classify regime
    regime_name, regime_explanation = regime.classify_regime(df)

    # Persist series (upsert by date)
    for _, row in df.iterrows():
        existing = db.query(PortfolioSeries).filter_by(date=row["date"]).first()
        if existing:
            for col in [
                "total_value", "net_deposits", "period_deposits",
                "spy_close", "period_return", "benchmark_return",
                "alpha", "cumulative_alpha", "rolling_4w_alpha",
                "rolling_8w_vol", "rolling_8w_alpha_vol",
                "running_peak", "drawdown", "beta_12w",
            ]:
                setattr(existing, col, _safe_val(row.get(col)))
        else:
            kwargs = {}
            for col in [
                "date", "total_value", "net_deposits", "period_deposits",
                "spy_close", "period_return", "benchmark_return",
                "alpha", "cumulative_alpha", "rolling_4w_alpha",
                "rolling_8w_vol", "rolling_8w_alpha_vol",
                "running_peak", "drawdown", "beta_12w",
            ]:
                kwargs[col] = _safe_val(row.get(col))
            db.add(PortfolioSeries(**kwargs))

    # Encrypt and store file
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    safe_name = os.path.basename(file.filename).replace(" ", "_")
    enc_path = os.path.join(settings.UPLOAD_DIR, f"{safe_name}.enc")
    encrypt_file(content, enc_path, settings.encryption_key_bytes)

    # Log import record
    imp = PortfolioImport(
        filename=file.filename,
        row_count=len(df),
        notes="; ".join(parse_errors) if parse_errors else None,
        raw_file_path=enc_path,
    )
    db.add(imp)

    # Run rule engine and persist recommendations
    rb = _get_or_create_rulebook(db)
    recs = rules.run_rule_engine(df, regime_name, rb.thresholds)
    for r in recs:
        db.add(
            Recommendation(
                title=r["title"],
                risk_level=r["risk_level"],
                category=r["category"],
                triggers=r["triggers"],
                explanation=r["explanation"],
                supporting_metrics=r["supporting_metrics"],
                actions=r["actions"],
                confidence=r["confidence"],
            )
        )

    db.commit()
    db.refresh(imp)

    return ImportResult(
        import_id=imp.id,
        filename=imp.filename,
        row_count=imp.row_count,
        regime=regime_name,
        regime_explanation=regime_explanation,
        message=f"Imported {imp.row_count} rows. {len(recs)} recommendation(s) generated.",
    )


@router.post("/preview-excel", response_model=ParsePreview)
async def preview_excel(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are accepted.")
    content = await file.read()
    result = excel_parser.preview_excel(content)
    return ParsePreview(**result)


@router.get("/series", response_model=list[PortfolioSeriesRow])
def get_series(db: Session = Depends(get_db)):
    rows = db.query(PortfolioSeries).order_by(PortfolioSeries.date).all()
    return rows


@router.post("/sync-spy-history", response_model=SpyHistorySyncResult)
def sync_spy_history(db: Session = Depends(get_db)):
    updated = _sync_spy_history_and_recompute(db)
    return SpyHistorySyncResult(
        updated_rows=updated,
        message="SPY close history synced and benchmark/alpha metrics recomputed.",
    )


@router.get("/summary", response_model=PortfolioSummary)
def get_summary(db: Session = Depends(get_db)):
    rows = db.query(PortfolioSeries).order_by(PortfolioSeries.date).all()
    if not rows:
        raise HTTPException(status_code=404, detail="No portfolio data found. Please import data.")

    import pandas as pd

    df = pd.DataFrame([
        {
            "date": r.date,
            "total_value": float(r.total_value),
            "net_deposits": float(r.net_deposits),
            "period_deposits": float(r.period_deposits),
            "spy_close": float(r.spy_close) if r.spy_close is not None else None,
            "period_return": float(r.period_return),
            "benchmark_return": float(r.benchmark_return),
            "alpha": float(r.alpha) if r.alpha is not None else None,
            "cumulative_alpha": float(r.cumulative_alpha) if r.cumulative_alpha is not None else None,
            "rolling_4w_alpha": float(r.rolling_4w_alpha) if r.rolling_4w_alpha is not None else None,
            "rolling_8w_vol": float(r.rolling_8w_vol) if r.rolling_8w_vol is not None else None,
            "rolling_8w_alpha_vol": float(r.rolling_8w_alpha_vol) if r.rolling_8w_alpha_vol is not None else None,
            "running_peak": float(r.running_peak) if r.running_peak is not None else None,
            "drawdown": float(r.drawdown) if r.drawdown is not None else None,
            "beta_12w": float(r.beta_12w) if r.beta_12w is not None else None,
        }
        for r in rows
    ])

    summary = metrics.compute_summary(df)
    regime_name, regime_explanation = regime.classify_regime(df)

    return PortfolioSummary(
        **summary,
        regime=regime_name,
        regime_explanation=regime_explanation,
    )


@router.delete("/imported-data", response_model=ClearImportedDataResult)
def clear_imported_data(db: Session = Depends(get_db)):
    imports = db.query(PortfolioImport).all()
    deleted_files = 0
    for imp in imports:
        file_path = imp.raw_file_path
        if file_path and os.path.isfile(file_path):
            try:
                os.remove(file_path)
                deleted_files += 1
            except OSError:
                # If file deletion fails, keep DB cleanup successful.
                pass

    deleted_series_rows = db.query(PortfolioSeries).delete(synchronize_session=False)
    deleted_import_rows = db.query(PortfolioImport).delete(synchronize_session=False)
    deleted_recommendation_rows = db.query(Recommendation).delete(synchronize_session=False)
    db.commit()

    return ClearImportedDataResult(
        deleted_series_rows=deleted_series_rows,
        deleted_import_rows=deleted_import_rows,
        deleted_recommendation_rows=deleted_recommendation_rows,
        deleted_files=deleted_files,
        message="Imported portfolio data cleared. You can now upload a fresh file.",
    )


@router.post("/manual-week", response_model=ManualWeekEntryResult)
def add_manual_week(entry: ManualWeekEntryIn, db: Session = Depends(get_db)):
    import pandas as pd

    rows = db.query(PortfolioSeries).order_by(PortfolioSeries.date).all()
    if not rows:
        raise HTTPException(
            status_code=400,
            detail="No imported portfolio data found. Import a file first.",
        )

    last_row = rows[-1]
    next_date = last_row.date + timedelta(days=7)

    period_deposits = float(entry.net_deposits) - float(last_row.net_deposits)
    if float(last_row.total_value) == 0:
        raise HTTPException(status_code=422, detail="Previous total value is zero; cannot compute period return.")

    period_return = (
        float(entry.total_value) - float(last_row.total_value) - period_deposits
    ) / float(last_row.total_value)

    try:
        closes = _fetch_spy_closes_for_dates([last_row.date, next_date])
        prev_spy_close = closes[last_row.date]
        current_spy_close = closes[next_date]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    benchmark_return = (current_spy_close / prev_spy_close) - 1.0

    base_df = pd.DataFrame(
        [
            {
                "date": r.date,
                "total_value": float(r.total_value),
                "net_deposits": float(r.net_deposits),
                "period_deposits": float(r.period_deposits),
                "spy_close": float(r.spy_close) if r.spy_close is not None else None,
                "period_return": float(r.period_return),
                "benchmark_return": float(r.benchmark_return),
            }
            for r in rows
        ]
    )

    new_df = pd.DataFrame(
        [
            {
                "date": next_date,
                "total_value": entry.total_value,
                "net_deposits": entry.net_deposits,
                "period_deposits": period_deposits,
                "spy_close": current_spy_close,
                "period_return": period_return,
                "benchmark_return": benchmark_return,
            }
        ]
    )

    full_df = pd.concat([base_df, new_df], ignore_index=True)
    full_df = metrics.compute_weekly_series(full_df)
    regime_name, regime_explanation = regime.classify_regime(full_df)

    existing_by_date = {r.date: r for r in rows}
    for _, row in full_df.iterrows():
        current_date = row["date"]
        existing = existing_by_date.get(current_date)
        if existing:
            for col in [
                "total_value", "net_deposits", "period_deposits",
                "spy_close", "period_return", "benchmark_return",
                "alpha", "cumulative_alpha", "rolling_4w_alpha",
                "rolling_8w_vol", "rolling_8w_alpha_vol",
                "running_peak", "drawdown", "beta_12w",
            ]:
                setattr(existing, col, _safe_val(row.get(col)))
        else:
            kwargs = {}
            for col in [
                "date", "total_value", "net_deposits", "period_deposits",
                "spy_close", "period_return", "benchmark_return",
                "alpha", "cumulative_alpha", "rolling_4w_alpha",
                "rolling_8w_vol", "rolling_8w_alpha_vol",
                "running_peak", "drawdown", "beta_12w",
            ]:
                kwargs[col] = _safe_val(row.get(col))
            db.add(PortfolioSeries(**kwargs))

    db.commit()

    return ManualWeekEntryResult(
        date=next_date,
        spy_close=current_spy_close,
        period_deposits=period_deposits,
        period_return=period_return,
        benchmark_return=benchmark_return,
        row_count=len(full_df),
        regime=regime_name,
        regime_explanation=regime_explanation,
        message="Manual weekly data added and metrics recomputed.",
    )
