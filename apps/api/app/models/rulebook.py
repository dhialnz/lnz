from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

DEFAULT_THRESHOLDS = {
    "drawdown_defensive": -0.08,
    "drawdown_hard_stop": -0.10,
    "vol8_high": 0.04,
    "concentration_trim": 0.15,
    "deploy_tranche_1": 0.30,
    "deploy_tranche_2": 0.30,
    "deploy_tranche_3": 0.40,
    "expansion_drawdown": -0.03,
    "near_peak_pct": 0.02,
    "profit_taking_mtd": 0.06,
}

DEFAULT_RULE_TEXT = """## LNZ Rule Engine

### Deployment Rules
- **Recovery → Tranche 1**: Regime is Recovery AND rolling-4w alpha improving ≥ 2 consecutive weeks → deploy 30% of available cash.
- **Expansion → Tranche 2**: Regime is Expansion AND alpha4 positive ≥ 2 consecutive weeks → deploy remaining cash in planned tranches.
- **Defensive → Hold**: Regime is Defensive → hold cash, avoid new high-beta exposure.

### Profit Taking Rules
- **Concentration Trim**: Any holding > 15% weight → trim 20–30%.
- **MTD Outperformance**: Portfolio up ≥ 6% MTD and outperforming benchmark → reduce volatility.

### Risk Control Rules
- **Hard Stop**: Drawdown ≤ −10% → reduce risk immediately; no new deployments.
- **Vol Spike**: Rolling-8w vol > 4% → reduce speculative exposure.

All thresholds are configurable via the Rulebook page.
"""


class Rulebook(Base):
    __tablename__ = "rulebook"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    thresholds: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=lambda: DEFAULT_THRESHOLDS.copy()
    )
    text: Mapped[str] = mapped_column(Text, nullable=False, default=DEFAULT_RULE_TEXT)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
