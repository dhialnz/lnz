#!/usr/bin/env python3
"""
Clean a portfolio workbook into upload-ready schema/format.

Usage:
    python scripts/clean_portfolio_excel.py --in "C:/path/input.xlsx"
    python scripts/clean_portfolio_excel.py --in "C:/path/input.xlsx" --out "C:/path/clean.xlsx"
    python scripts/clean_portfolio_excel.py --in "C:/path/input.xlsx" --dayfirst
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import pandas as pd

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.services.excel_parser import parse_excel


def _fmt_currency(val: float) -> str:
    return f"${val:,.2f}"


def _fmt_percent(val: float) -> str:
    return f"{val * 100:.4f}%"


def clean_excel(input_path: str, output_path: str, dayfirst: bool = False) -> tuple[int, list[str]]:
    with open(input_path, "rb") as f:
        content = f.read()

    df, errors = parse_excel(content, dayfirst=dayfirst)

    clean = pd.DataFrame(
        {
            "Date": pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d"),
            "Total Value": df["total_value"].map(_fmt_currency),
            "Net Deposits": df["net_deposits"].map(_fmt_currency),
            "Period Deposits": df["period_deposits"].map(_fmt_currency),
            "Period Return": df["period_return"].map(_fmt_percent),
            "SPY Period Return": df["benchmark_return"].map(_fmt_percent),
        }
    )

    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else ".", exist_ok=True)
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        clean.to_excel(writer, index=False, sheet_name="Portfolio")
        ws = writer.sheets["Portfolio"]
        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            ws.column_dimensions[col[0].column_letter].width = max_len + 2

    return len(clean), errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean a portfolio Excel file for upload")
    parser.add_argument("--in", dest="input_path", required=True, help="Input .xlsx path")
    parser.add_argument("--out", dest="output_path", help="Output .xlsx path")
    parser.add_argument("--dayfirst", action="store_true", help="Use day-first date parsing")
    args = parser.parse_args()

    input_path = args.input_path
    output_path = args.output_path
    if not output_path:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}.clean{ext or '.xlsx'}"

    row_count, errors = clean_excel(input_path, output_path, dayfirst=args.dayfirst)

    print(f"Clean Excel written to: {output_path}")
    print(f"Rows written: {row_count}")
    if errors:
        print("Warnings:")
        for e in errors:
            print(f"- {e}")


if __name__ == "__main__":
    main()
