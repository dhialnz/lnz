from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, HTTPException

from app.services import yahoo_quotes

router = APIRouter(prefix="/fx", tags=["fx"])


@router.get("")
async def get_fx_rate() -> dict:
    """
    Return the current CAD/USD exchange rate from Yahoo Finance.
    Response fields:
        usd_per_cad  - how many USD for 1 CAD (e.g. 0.7234)
        cad_per_usd  - how many CAD for 1 USD (e.g. 1.3824)
        fetched_at   - UTC ISO timestamp
    """
    usd_per_cad = await yahoo_quotes.fetch_usd_per_cad()
    if usd_per_cad is None:
        raise HTTPException(
            status_code=502,
            detail="Could not fetch CAD/USD exchange rate from Yahoo Finance.",
        )

    return {
        "usd_per_cad": round(usd_per_cad, 6),
        "cad_per_usd": round(1.0 / usd_per_cad, 6),
        "fetched_at": dt.datetime.utcnow().isoformat() + "Z",
    }