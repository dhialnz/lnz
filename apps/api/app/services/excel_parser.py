"""
Excel ingestion and normalisation pipeline.
Supports .xlsx, auto-detects date formats, sanitises currency and percent strings.
"""

from __future__ import annotations

from datetime import date, datetime
from io import BytesIO
from typing import Optional

import pandas as pd


# Required columns (case-insensitive canonical names -> internal names)
REQUIRED_COLUMNS: dict[str, str] = {
    "date": "date",
    "total value": "total_value",
    "net deposits": "net_deposits",
    "period deposits": "period_deposits",
    "period return": "period_return",
    "spy period return": "benchmark_return",
}

OPTIONAL_DEFAULTS: dict[str, float] = {
    "net_deposits": 0.0,
    "period_deposits": 0.0,
}


def _sanitise_currency(val) -> Optional[float]:
    """Strip $ , whitespace and convert to float."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip().replace("$", "").replace(",", "").replace(" ", "")
    if s in ("", "-", "N/A", "n/a"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _sanitise_percent(val) -> Optional[float]:
    """Convert '3.65%' or 0.0365 to decimal float."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip()
    if s.endswith("%"):
        try:
            return float(s[:-1]) / 100.0
        except ValueError:
            return None
    try:
        f = float(s)
        # Heuristic: if absolute value > 1, assume it's already in percent form
        if abs(f) > 1:
            return f / 100.0
        return f
    except ValueError:
        return None


def _parse_date(val, dayfirst: bool = False) -> Optional[date]:
    """Parse a date value from various formats, including datetime strings."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, pd.Timestamp):
        return val.date()
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val

    s = str(val).strip()
    if not s or s.lower() in ("nan", "nat", "none"):
        return None

    fmts = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%m/%d/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
        "%m-%d-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M:%S",
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%m-%d-%Y",
    ]
    if dayfirst:
        fmts = ["%d/%m/%Y %H:%M:%S", "%d-%m-%Y %H:%M:%S", "%d/%m/%Y", "%d-%m-%Y"] + fmts

    for fmt in fmts:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue

    parsed = pd.to_datetime(s, dayfirst=dayfirst, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.date()


def _normalise_column_names(df: pd.DataFrame) -> dict[str, str]:
    """Map raw column names to internal names (case-insensitive)."""
    mapping: dict[str, str] = {}
    for raw_col in df.columns:
        canon = raw_col.strip().lower()
        if canon in REQUIRED_COLUMNS:
            mapping[raw_col] = REQUIRED_COLUMNS[canon]
    return mapping


def parse_excel(
    content: bytes,
    sheet_name: int | str = 0,
    dayfirst: bool = False,
) -> tuple[pd.DataFrame, list[str]]:
    """
    Parse an Excel file and return (normalised_df, list_of_errors).

    The returned DataFrame has columns:
        date, total_value, net_deposits, period_deposits,
        period_return, benchmark_return

    Errors are non-fatal warnings (missing optional columns, parse issues).
    Fatal errors raise ValueError.
    """
    errors: list[str] = []

    try:
        raw = pd.read_excel(BytesIO(content), sheet_name=sheet_name, dtype=str, engine="openpyxl")
    except Exception as exc:
        raise ValueError(f"Failed to read Excel file: {exc}") from exc

    if raw.empty:
        raise ValueError("Excel sheet is empty.")

    # Strip whitespace from column headers
    raw.columns = [str(c).strip() for c in raw.columns]

    col_map = _normalise_column_names(raw)
    missing = [v for v in REQUIRED_COLUMNS.values() if v not in col_map.values()]

    # net_deposits and period_deposits are optional
    optional_missing = [m for m in missing if m in OPTIONAL_DEFAULTS]
    fatal_missing = [m for m in missing if m not in OPTIONAL_DEFAULTS]

    if fatal_missing:
        raise ValueError(
            f"Missing required columns: {fatal_missing}. "
            f"Found: {list(raw.columns)}"
        )

    for m in optional_missing:
        errors.append(f"Optional column '{m}' not found; defaulting to 0.")

    df = raw.rename(columns=col_map)

    # Keep only known columns
    keep = [c for c in REQUIRED_COLUMNS.values() if c in df.columns]
    df = df[keep].copy()

    # Add missing optional columns with defaults
    for col, default in OPTIONAL_DEFAULTS.items():
        if col not in df.columns:
            df[col] = default

    # Parse dates
    parsed_dates = []
    for i, val in enumerate(df["date"]):
        d = _parse_date(val, dayfirst=dayfirst)
        if d is None:
            errors.append(f"Row {i + 2}: could not parse date '{val}', skipping row.")
        parsed_dates.append(d)
    df["date"] = parsed_dates
    df = df.dropna(subset=["date"])

    # Sanitise numeric columns
    currency_cols = ["total_value", "net_deposits", "period_deposits"]
    percent_cols = ["period_return", "benchmark_return"]

    for col in currency_cols:
        if col in df.columns:
            df[col] = df[col].apply(_sanitise_currency)

    for col in percent_cols:
        if col in df.columns:
            df[col] = df[col].apply(_sanitise_percent)

    # Drop rows with NaN in critical numeric columns
    critical = ["total_value", "period_return", "benchmark_return"]
    before = len(df)
    df = df.dropna(subset=critical)
    dropped = before - len(df)
    if dropped > 0:
        errors.append(f"{dropped} row(s) dropped due to missing critical values.")

    # Type casts
    df["date"] = pd.to_datetime(df["date"]).dt.date
    for col in ["total_value", "net_deposits", "period_deposits", "period_return", "benchmark_return"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    if df.empty:
        raise ValueError("No valid rows remain after parsing.")

    df = df.sort_values("date").reset_index(drop=True)
    return df, errors


def preview_excel(
    content: bytes,
    sheet_name: int | str = 0,
    max_rows: int = 10,
) -> dict:
    """
    Return a quick preview dict without full validation.
    Used by the import wizard to show column names and sample rows.
    """
    try:
        raw = pd.read_excel(BytesIO(content), sheet_name=sheet_name, dtype=str, engine="openpyxl")
        raw.columns = [str(c).strip() for c in raw.columns]
        return {
            "columns": list(raw.columns),
            "rows": raw.head(max_rows).fillna("").to_dict(orient="records"),
            "row_count": len(raw),
            "errors": [],
        }
    except Exception as exc:
        return {
            "columns": [],
            "rows": [],
            "row_count": 0,
            "errors": [str(exc)],
        }
