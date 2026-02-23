"""Tests for Excel ingestion and normalisation."""

from __future__ import annotations

from io import BytesIO

import pandas as pd
import pytest

from app.services.excel_parser import parse_excel, preview_excel


def _make_excel(data: dict) -> bytes:
    """Helper: build an in-memory .xlsx from a dict of columns."""
    df = pd.DataFrame(data)
    buf = BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    return buf.getvalue()


VALID_DATA = {
    "Date": ["01/05/2024", "01/12/2024", "01/19/2024"],
    "Total Value": ["$100,000.00", "$101,500.00", "$102,800.00"],
    "Net Deposits": ["$100,000.00", "$100,000.00", "$100,000.00"],
    "Period Deposits": ["$0.00", "$0.00", "$0.00"],
    "Period Return": ["1.50%", "1.30%", "1.28%"],
    "SPY Period Return": ["1.00%", "0.90%", "0.80%"],
}


class TestParsing:
    def test_parses_valid_file(self):
        content = _make_excel(VALID_DATA)
        df, errors = parse_excel(content)
        assert len(df) == 3
        assert list(df.columns) == [
            "date", "total_value", "net_deposits", "period_deposits",
            "period_return", "benchmark_return",
        ]

    def test_currency_sanitisation(self):
        content = _make_excel(VALID_DATA)
        df, _ = parse_excel(content)
        assert abs(df["total_value"].iloc[0] - 100_000.0) < 0.01
        assert abs(df["total_value"].iloc[1] - 101_500.0) < 0.01

    def test_percent_sanitisation(self):
        content = _make_excel(VALID_DATA)
        df, _ = parse_excel(content)
        assert abs(df["period_return"].iloc[0] - 0.015) < 1e-9
        assert abs(df["benchmark_return"].iloc[0] - 0.01) < 1e-9

    def test_dayfirst_date_parsing(self):
        data = dict(VALID_DATA)
        data["Date"] = ["05/01/2024", "12/01/2024", "19/01/2024"]
        content = _make_excel(data)
        df, errors = parse_excel(content, dayfirst=True)
        assert len(df) == 3

    def test_handles_missing_optional_columns(self):
        data = {k: v for k, v in VALID_DATA.items() if k not in ("Net Deposits", "Period Deposits")}
        content = _make_excel(data)
        df, errors = parse_excel(content)
        assert "net_deposits" in df.columns
        assert "period_deposits" in df.columns
        assert (df["net_deposits"] == 0.0).all()
        assert any("Optional column" in e for e in errors)

    def test_raises_on_missing_required_column(self):
        data = {k: v for k, v in VALID_DATA.items() if k != "Period Return"}
        content = _make_excel(data)
        with pytest.raises(ValueError, match="Missing required columns"):
            parse_excel(content)

    def test_raises_on_empty_file(self):
        buf = BytesIO()
        pd.DataFrame().to_excel(buf, index=False, engine="openpyxl")
        with pytest.raises(ValueError):
            parse_excel(buf.getvalue())

    def test_rows_sorted_by_date(self):
        data = dict(VALID_DATA)
        # Reverse the order
        for k in data:
            data[k] = list(reversed(data[k]))
        content = _make_excel(data)
        df, _ = parse_excel(content)
        dates = df["date"].tolist()
        assert dates == sorted(dates)

    def test_decimal_returns_accepted(self):
        """Period Return as a decimal (0.015 not 1.5%) should also be accepted."""
        data = dict(VALID_DATA)
        data["Period Return"] = ["0.015", "0.013", "0.0128"]
        data["SPY Period Return"] = ["0.010", "0.009", "0.008"]
        content = _make_excel(data)
        df, _ = parse_excel(content)
        assert abs(df["period_return"].iloc[0] - 0.015) < 1e-9


class TestPreview:
    def test_preview_returns_columns_and_rows(self):
        content = _make_excel(VALID_DATA)
        result = preview_excel(content)
        assert "columns" in result
        assert "rows" in result
        assert "row_count" in result
        assert len(result["columns"]) == 6
        assert result["row_count"] == 3

    def test_preview_handles_corrupt_file(self):
        result = preview_excel(b"not an excel file")
        assert result["errors"]
        assert result["row_count"] == 0
