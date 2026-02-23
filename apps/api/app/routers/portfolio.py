from __future__ import annotations

import math
import os
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.portfolio import PortfolioImport, PortfolioSeries
from app.models.rulebook import Rulebook, DEFAULT_THRESHOLDS
from app.models.recommendations import Recommendation
from app.schemas.portfolio import ImportResult, ParsePreview, PortfolioSeriesRow, PortfolioSummary
from app.services import excel_parser, metrics, regime, rules
from app.utils.crypto import encrypt_file, decrypt_file

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

    # Classify regime
    regime_name, regime_explanation = regime.classify_regime(df)

    # Persist series (upsert by date)
    for _, row in df.iterrows():
        existing = db.query(PortfolioSeries).filter_by(date=row["date"]).first()
        if existing:
            for col in [
                "total_value", "net_deposits", "period_deposits",
                "period_return", "benchmark_return",
                "alpha", "cumulative_alpha", "rolling_4w_alpha",
                "rolling_8w_vol", "rolling_8w_alpha_vol",
                "running_peak", "drawdown", "beta_12w",
            ]:
                setattr(existing, col, _safe_val(row.get(col)))
        else:
            kwargs = {}
            for col in [
                "date", "total_value", "net_deposits", "period_deposits",
                "period_return", "benchmark_return",
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
