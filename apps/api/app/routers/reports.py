from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.holdings import Holding
from app.models.portfolio import PortfolioSeries
from app.models.portfolio_book import PortfolioBook
from app.models.recommendations import Recommendation
from app.models.user import User
from app.services.auth_service import require_command
from app.services.portfolio_scope import require_active_portfolio_id

router = APIRouter(prefix="/reports", tags=["reports"])


def _line_writer(c, x: float, y: float, text: str, size: int = 11) -> float:
    c.setFont("Helvetica", size)
    c.drawString(x, y, text)
    return y - (size + 4)


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

