from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers.holdings import get_holdings_for_user
from app.models.holdings import Holding
from app.models.portfolio import PortfolioSeries
from app.models.portfolio_book import PortfolioBook
from app.models.recommendations import Recommendation
from app.models.user import User
from app.services import yahoo_quotes
from app.services.auth_service import get_current_user, require_command
from app.services.portfolio_scope import require_active_portfolio_id

router = APIRouter(prefix="/reports", tags=["reports"])


def _line_writer(c, x: float, y: float, text: str, size: int = 11) -> float:
    c.setFont("Helvetica", size)
    c.drawString(x, y, text)
    return y - (size + 4)


def _fmt_money(value: float | None, currency: str = "USD", decimals: int = 0) -> str:
    if value is None:
        return "—"
    prefix = "CA$" if currency == "CAD" else "US$"
    return f"{prefix}{value:,.{decimals}f}"


def _fmt_signed_money(value: float | None, currency: str = "USD", decimals: int = 0) -> str:
    if value is None:
        return "—"
    sign = "+" if value >= 0 else "-"
    return f"{sign}{_fmt_money(abs(value), currency, decimals)}"


def _fmt_pct(value: float | None, decimals: int = 2) -> str:
    if value is None:
        return "—"
    return f"{value * 100:.{decimals}f}%"


def _fmt_signed_pct(value: float | None, decimals: int = 2) -> str:
    if value is None:
        return "—"
    sign = "+" if value >= 0 else ""
    return f"{sign}{value * 100:.{decimals}f}%"


def _safe_filename_part(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in value.lower())
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-") or "portfolio"


def _draw_report_background(c, width: float, height: float) -> None:
    from reportlab.lib import colors

    c.setFillColor(colors.HexColor("#09090B"))
    c.rect(0, 0, width, height, fill=1, stroke=0)


def _draw_metric_card(
    c,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    label: str,
    value: str,
    sub: str | None = None,
    value_color: str = "#F97316",
) -> None:
    from reportlab.lib import colors

    c.setFillColor(colors.HexColor("#13151A"))
    c.setStrokeColor(colors.HexColor("#252833"))
    c.roundRect(x, y - height, width, height, 10, fill=1, stroke=1)

    c.setFillColor(colors.HexColor("#71717A"))
    c.setFont("Helvetica", 8)
    c.drawString(x + 12, y - 18, label.upper())

    c.setFillColor(colors.HexColor(value_color))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(x + 12, y - 38, value)

    if sub:
        c.setFillColor(colors.HexColor("#A1A1AA"))
        c.setFont("Helvetica", 8)
        c.drawString(x + 12, y - 52, sub[:52])


@router.get("/holdings.pdf")
async def export_holdings_pdf(
    currency: Literal["CAD", "USD"] = Query(default="CAD"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import LETTER, landscape
    from reportlab.pdfgen import canvas

    portfolio_id = require_active_portfolio_id(user)
    portfolio = (
        db.query(PortfolioBook)
        .filter(PortfolioBook.id == portfolio_id, PortfolioBook.user_id == user.id)
        .first()
    )
    if not portfolio:
        raise HTTPException(status_code=404, detail="Active portfolio not found.")

    snapshot = await get_holdings_for_user(db, user.id, portfolio_id)
    if not snapshot.holdings:
        raise HTTPException(status_code=404, detail="No holdings saved.")

    usd_per_cad = await yahoo_quotes.fetch_usd_per_cad() if currency == "CAD" else None
    effective_currency = currency
    currency_note: str | None = None
    if currency == "CAD" and not usd_per_cad:
        effective_currency = "USD"
        currency_note = "CAD FX unavailable at export time; report values shown in USD."

    def convert_usd(value: float | None) -> float | None:
        if value is None:
            return None
        if effective_currency == "USD":
            return value
        if not usd_per_cad:
            return value
        return value / usd_per_cad

    def convert_cost_per_share(holding) -> float | None:
        if holding.avg_cost_per_share_usd is not None:
            return convert_usd(float(holding.avg_cost_per_share_usd))
        if effective_currency == holding.avg_cost_currency:
            return float(holding.avg_cost_per_share)
        return None

    holdings = sorted(
        snapshot.holdings,
        key=lambda h: float(h.total_value or 0.0),
        reverse=True,
    )

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=landscape(LETTER))
    width, height = landscape(LETTER)

    def start_page() -> float:
        _draw_report_background(c, width, height)
        return height - 42

    y = start_page()
    c.setFillColor(colors.HexColor("#F97316"))
    c.setFont("Helvetica-Bold", 24)
    c.drawString(42, y, "Alphenzi Holdings Snapshot")

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    as_of = snapshot.as_of.replace("T", " ").replace("Z", " UTC")
    c.setFillColor(colors.HexColor("#A1A1AA"))
    c.setFont("Helvetica", 10)
    c.drawString(
        42,
        y - 20,
        f"Portfolio: {portfolio.name}    Generated: {generated_at}    Prices as of: {as_of}",
    )
    c.drawString(
        42,
        y - 34,
        f"Holdings: {len(holdings)}    Display currency: {effective_currency}",
    )
    y -= 64

    if snapshot.fx_warning or currency_note:
        c.setFillColor(colors.HexColor("#2A1B08"))
        c.setStrokeColor(colors.HexColor("#A16207"))
        c.roundRect(42, y - 24, width - 84, 24, 8, fill=1, stroke=1)
        c.setFillColor(colors.HexColor("#FBBF24"))
        c.setFont("Helvetica", 9)
        warning_text = currency_note or (
            "FX rate was unavailable when holdings were priced. CAD-cost basis values may be approximate."
        )
        c.drawString(52, y - 15, warning_text[:140])
        y -= 36

    card_width = (width - 84 - (4 * 12)) / 5
    first_row = [
        ("Total Value", _fmt_money(convert_usd(snapshot.total_value), effective_currency), f"Cost basis {_fmt_money(convert_usd(snapshot.total_cost_basis), effective_currency)}", "#F97316"),
        ("Unrealized P&L", _fmt_signed_money(convert_usd(snapshot.total_unrealized_pnl), effective_currency), _fmt_signed_pct(snapshot.total_unrealized_pnl_pct), "#22C55E" if (snapshot.total_unrealized_pnl or 0) >= 0 else "#EF4444"),
        ("Day Change", _fmt_signed_money(convert_usd(snapshot.total_day_change), effective_currency), _fmt_signed_pct(snapshot.total_day_change_pct), "#22C55E" if (snapshot.total_day_change or 0) >= 0 else "#EF4444"),
        ("Week Change", _fmt_signed_money(convert_usd(snapshot.total_week_change), effective_currency), _fmt_signed_pct(snapshot.total_week_change_pct), "#22C55E" if (snapshot.total_week_change or 0) >= 0 else "#EF4444"),
        ("Month Change", _fmt_signed_money(convert_usd(snapshot.total_month_change), effective_currency), _fmt_signed_pct(snapshot.total_month_change_pct), "#22C55E" if (snapshot.total_month_change or 0) >= 0 else "#EF4444"),
    ]
    second_row = [
        ("Sharpe (30D)", "—" if snapshot.sharpe_30d is None else f"{snapshot.sharpe_30d:.2f}", "Annualised", "#22C55E"),
        ("Sortino (30D)", "—" if snapshot.sortino_30d is None else f"{snapshot.sortino_30d:.2f}", "Annualised", "#22C55E"),
        ("Profit Factor", "—" if snapshot.profit_factor is None else f"{snapshot.profit_factor:.2f}", "Gross gains / losses", "#F59E0B"),
        ("CAGR", _fmt_signed_pct(snapshot.cagr), "Annualised growth", "#22C55E" if (snapshot.cagr or 0) >= 0 else "#EF4444"),
        ("R-Expectancy", "—" if snapshot.r_expectancy is None else f"{snapshot.r_expectancy:.2f}", f"MAE {_fmt_signed_pct(snapshot.mae)} | MFE {_fmt_signed_pct(snapshot.mfe)}", "#22C55E"),
    ]

    x = 42
    for label, value, sub, color in first_row:
        _draw_metric_card(c, x=x, y=y, width=card_width, height=62, label=label, value=value, sub=sub, value_color=color)
        x += card_width + 12
    y -= 76
    x = 42
    for label, value, sub, color in second_row:
        _draw_metric_card(c, x=x, y=y, width=card_width, height=62, label=label, value=value, sub=sub, value_color=color)
        x += card_width + 12
    y -= 84

    c.setFillColor(colors.HexColor("#E5E7EB"))
    c.setFont("Helvetica-Bold", 13)
    c.drawString(42, y, "Current Holdings")
    y -= 20

    columns = [
        ("Ticker", 58),
        ("Shares", 54),
        ("Price", 68),
        ("Value", 76),
        ("Weight", 50),
        ("P&L", 74),
        ("P&L %", 52),
        ("Day %", 50),
        ("Cost/Share", 76),
        ("Added", 64),
    ]
    row_height = 30
    notes: list[str] = []

    def draw_table_header(top_y: float) -> float:
        c.setFillColor(colors.HexColor("#13151A"))
        c.setStrokeColor(colors.HexColor("#252833"))
        c.roundRect(42, top_y - 22, width - 84, 22, 8, fill=1, stroke=1)
        c.setFillColor(colors.HexColor("#71717A"))
        c.setFont("Helvetica-Bold", 8)
        cursor = 50
        for label, col_width in columns:
            c.drawString(cursor, top_y - 14, label.upper())
            cursor += col_width
        return top_y - 30

    y = draw_table_header(y)

    for holding in holdings:
        if y < 60:
            c.showPage()
            y = start_page()
            c.setFillColor(colors.HexColor("#E5E7EB"))
            c.setFont("Helvetica-Bold", 13)
            c.drawString(42, y, "Current Holdings (continued)")
            y = draw_table_header(y - 20)

        c.setStrokeColor(colors.HexColor("#1F2937"))
        c.line(42, y - row_height + 4, width - 42, y - row_height + 4)

        cursor = 50
        added = holding.added_at.strftime("%Y-%m-%d")
        name = (holding.name or "").strip()
        pnl_color = "#22C55E" if (holding.unrealized_pnl or 0) >= 0 else "#EF4444"
        day_color = "#22C55E" if (holding.day_change_pct or 0) >= 0 else "#EF4444"

        c.setFillColor(colors.HexColor("#F97316"))
        c.setFont("Helvetica-Bold", 9)
        ticker_text = f"{holding.ticker}{'*' if holding.notes else ''}"
        c.drawString(cursor, y - 10, ticker_text[:10])
        c.setFillColor(colors.HexColor("#71717A"))
        c.setFont("Helvetica", 6)
        c.drawString(cursor, y - 20, name[:18] if name else "—")
        cursor += columns[0][1]

        c.setFillColor(colors.HexColor("#E5E7EB"))
        c.setFont("Helvetica", 8)
        c.drawRightString(cursor + 40, y - 12, f"{holding.shares:,.4f}".rstrip("0").rstrip("."))
        cursor += columns[1][1]

        c.drawRightString(cursor + 56, y - 12, _fmt_money(convert_usd(holding.current_price), effective_currency, 2))
        cursor += columns[2][1]

        c.drawRightString(cursor + 64, y - 12, _fmt_money(convert_usd(holding.total_value), effective_currency, 0))
        cursor += columns[3][1]

        c.drawRightString(cursor + 40, y - 12, _fmt_pct(holding.weight, 1))
        cursor += columns[4][1]

        c.setFillColor(colors.HexColor(pnl_color))
        c.drawRightString(cursor + 62, y - 12, _fmt_signed_money(convert_usd(holding.unrealized_pnl), effective_currency, 0))
        cursor += columns[5][1]

        c.drawRightString(cursor + 40, y - 12, _fmt_signed_pct(holding.unrealized_pnl_pct, 2))
        cursor += columns[6][1]

        c.setFillColor(colors.HexColor(day_color))
        c.drawRightString(cursor + 38, y - 12, _fmt_signed_pct(holding.day_change_pct, 2))
        cursor += columns[7][1]

        c.setFillColor(colors.HexColor("#A1A1AA"))
        cost_per_share = convert_cost_per_share(holding)
        cost_text = _fmt_money(cost_per_share, effective_currency, 2) if cost_per_share is not None else f"{holding.avg_cost_currency} {holding.avg_cost_per_share:,.2f}"
        c.drawRightString(cursor + 62, y - 12, cost_text[:16])
        cursor += columns[8][1]

        c.drawRightString(cursor + 52, y - 12, added)
        y -= row_height

        if holding.notes:
            notes.append(f"{holding.ticker}: {holding.notes}")

    if notes:
        c.showPage()
        y = start_page()
        c.setFillColor(colors.HexColor("#F97316"))
        c.setFont("Helvetica-Bold", 18)
        c.drawString(42, y, "Position Notes")
        y -= 26
        c.setFillColor(colors.HexColor("#A1A1AA"))
        c.setFont("Helvetica", 9)
        c.drawString(42, y, "Notes saved on holdings are included below for export completeness.")
        y -= 24

        for note in notes:
            if y < 54:
                c.showPage()
                y = start_page()
            c.setFillColor(colors.HexColor("#E5E7EB"))
            c.setFont("Helvetica-Bold", 9)
            parts = note.split(": ", 1)
            c.drawString(42, y, parts[0])
            c.setFillColor(colors.HexColor("#A1A1AA"))
            c.setFont("Helvetica", 9)
            c.drawString(92, y, parts[1][:115] if len(parts) > 1 else "")
            y -= 16

    c.showPage()
    c.save()
    buf.seek(0)

    filename = f"alphenzi-holdings-{_safe_filename_part(portfolio.name)}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/weekly.pdf")
def export_weekly_pdf(
    db: Session = Depends(get_db),
    user: User = Depends(require_command),
):
    portfolio_id = require_active_portfolio_id(user)

    portfolio = (
        db.query(PortfolioBook)
        .filter(PortfolioBook.id == portfolio_id, PortfolioBook.user_id == user.id)
        .first()
    )
    if not portfolio:
        raise HTTPException(status_code=404, detail="Active portfolio not found.")

    latest = (
        db.query(PortfolioSeries)
        .filter(
            PortfolioSeries.user_id == user.id,
            PortfolioSeries.portfolio_id == portfolio_id,
        )
        .order_by(PortfolioSeries.date.desc())
        .first()
    )
    if not latest:
        raise HTTPException(
            status_code=404,
            detail="No portfolio series found. Import portfolio data first.",
        )

    recs = (
        db.query(Recommendation)
        .filter(
            Recommendation.user_id == user.id,
            Recommendation.portfolio_id == portfolio_id,
        )
        .order_by(Recommendation.created_at.desc())
        .limit(10)
        .all()
    )
    holdings = (
        db.query(Holding)
        .filter(Holding.user_id == user.id, Holding.portfolio_id == portfolio_id)
        .order_by(Holding.added_at.desc())
        .limit(12)
        .all()
    )

    # Lazy import keeps app boot fast and avoids hard dependency until used.
    from reportlab.lib.pagesizes import LETTER
    from reportlab.pdfgen import canvas

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)
    width, height = LETTER
    y = height - 48

    c.setFont("Helvetica-Bold", 18)
    c.drawString(48, y, "Alphenzi Weekly Portfolio Report")
    y -= 26

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    y = _line_writer(
        c,
        48,
        y,
        f"User: {user.email or user.clerk_id}    Portfolio: {portfolio.name}    Generated: {timestamp}",
        size=10,
    )
    y -= 6

    c.setFont("Helvetica-Bold", 13)
    c.drawString(48, y, "Portfolio Snapshot")
    y -= 18

    y = _line_writer(c, 48, y, f"Week ending: {latest.date.isoformat()}")
    y = _line_writer(c, 48, y, f"Total value: {float(latest.total_value):,.2f} CAD")
    y = _line_writer(c, 48, y, f"Cumulative deposits: {float(latest.net_deposits):,.2f} CAD")
    y = _line_writer(c, 48, y, f"Weekly return: {float(latest.period_return) * 100:.2f}%")
    y = _line_writer(c, 48, y, f"Benchmark return: {float(latest.benchmark_return) * 100:.2f}%")
    y = _line_writer(
        c,
        48,
        y,
        f"Alpha: {float(latest.alpha) * 100:.2f}%" if latest.alpha is not None else "Alpha: n/a",
    )
    y = _line_writer(
        c,
        48,
        y,
        f"Drawdown: {float(latest.drawdown) * 100:.2f}%"
        if latest.drawdown is not None
        else "Drawdown: n/a",
    )

    y -= 10
    c.setFont("Helvetica-Bold", 13)
    c.drawString(48, y, "Latest Recommendations")
    y -= 18

    if not recs:
        y = _line_writer(c, 48, y, "No recommendations generated yet.")
    else:
        for idx, rec in enumerate(recs, start=1):
            headline = f"{idx}. [{rec.risk_level}] {rec.title}"
            y = _line_writer(c, 48, y, headline)
            if y < 120:
                c.showPage()
                y = height - 48

    y -= 8
    c.setFont("Helvetica-Bold", 13)
    c.drawString(48, y, "Holdings (recent)")
    y -= 18

    if not holdings:
        y = _line_writer(c, 48, y, "No holdings saved.")
    else:
        for h in holdings:
            line = f"- {h.ticker}: {float(h.shares):,.4f} shares @ {float(h.avg_cost_per_share):,.2f} {h.avg_cost_currency}"
            y = _line_writer(c, 48, y, line, size=10)
            if y < 60:
                c.showPage()
                y = height - 48

    c.showPage()
    c.save()
    buf.seek(0)

    filename = f"alphenzi-weekly-{portfolio.name.lower().replace(' ', '-')}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
