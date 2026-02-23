#!/usr/bin/env python3
"""
Generate a sample portfolio Excel file with plausible weekly data.

Usage:
    python scripts/generate_sample_excel.py
    python scripts/generate_sample_excel.py --weeks 52 --out uploads/my_portfolio.xlsx
"""

from __future__ import annotations

import argparse
import os
import random
from datetime import date, timedelta
from io import BytesIO

import pandas as pd

# ── Simulation parameters ──────────────────────────────────────────────────────
STARTING_VALUE = 150_000.0
STARTING_DEPOSITS = 150_000.0
WEEKLY_DRIFT = 0.0020  # ~10% annual drift
WEEKLY_VOL = 0.0180  # ~13% annual vol
SPY_WEEKLY_DRIFT = 0.0018
SPY_WEEKLY_VOL = 0.0150
SEED = 42


def generate_sample_data(
    weeks: int = 52,
    start_date: date | None = None,
) -> pd.DataFrame:
    random.seed(SEED)

    if start_date is None:
        # Start ~52 weeks before today
        start_date = date.today() - timedelta(weeks=weeks)
    # Move to next Friday
    while start_date.weekday() != 4:
        start_date += timedelta(days=1)

    rows = []
    value = STARTING_VALUE
    net_deposits = STARTING_DEPOSITS

    # Simulate a mild bear phase then recovery then expansion
    phase_schedule = _build_phase_schedule(weeks)

    for i in range(weeks):
        current_date = start_date + timedelta(weeks=i)
        phase = phase_schedule[i]

        rp = _sample_return(phase, "portfolio")
        rb = _sample_return(phase, "spy")

        prev_value = value
        value = value * (1 + rp)

        period_deposit = 0.0
        if i % 8 == 0 and i > 0:  # Occasional deposits
            period_deposit = random.choice([0.0, 0.0, 5_000.0])
            value += period_deposit
            net_deposits += period_deposit

        rows.append(
            {
                "Date": current_date.strftime("%m/%d/%Y"),
                "Total Value": f"${value:,.2f}",
                "Net Deposits": f"${net_deposits:,.2f}",
                "Period Deposits": f"${period_deposit:,.2f}",
                "Period Return": f"{rp * 100:.4f}%",
                "SPY Period Return": f"{rb * 100:.4f}%",
            }
        )

    return pd.DataFrame(rows)


def _build_phase_schedule(weeks: int) -> list[str]:
    """Partition weeks into bear → recovery → expansion phases."""
    bear_end = weeks // 4
    recovery_end = weeks // 2
    phases = []
    for i in range(weeks):
        if i < bear_end:
            phases.append("bear")
        elif i < recovery_end:
            phases.append("recovery")
        else:
            phases.append("expansion")
    return phases


def _sample_return(phase: str, asset: str) -> float:
    """Sample a weekly return conditioned on market phase."""
    if phase == "bear":
        drift = -0.0050 if asset == "portfolio" else -0.0040
        vol = 0.0250 if asset == "portfolio" else 0.0220
    elif phase == "recovery":
        drift = 0.0010 if asset == "portfolio" else 0.0008
        vol = 0.0180 if asset == "portfolio" else 0.0160
    else:  # expansion
        drift = WEEKLY_DRIFT if asset == "portfolio" else SPY_WEEKLY_DRIFT
        vol = WEEKLY_VOL if asset == "portfolio" else SPY_WEEKLY_VOL

    return random.gauss(drift, vol)


def write_excel(df: pd.DataFrame, output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else ".", exist_ok=True)
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Portfolio")
        # Auto-size columns
        ws = writer.sheets["Portfolio"]
        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            ws.column_dimensions[col[0].column_letter].width = max_len + 4
    print(f"✓ Sample Excel written to: {output_path}")
    print(f"  Rows: {len(df)}")
    print(f"  Date range: {df['Date'].iloc[0]}  →  {df['Date'].iloc[-1]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate sample portfolio Excel file")
    parser.add_argument("--weeks", type=int, default=52, help="Number of weekly rows")
    parser.add_argument("--out", type=str, default="uploads/sample_portfolio.xlsx")
    args = parser.parse_args()

    df = generate_sample_data(weeks=args.weeks)
    write_excel(df, args.out)
