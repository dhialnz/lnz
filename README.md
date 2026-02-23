# LNZ – Portfolio Analytics & Decision Support

> **Disclaimer:** LNZ is an analytics tool only. It produces rule-based, explainable outputs. Nothing in this application constitutes financial advice, a solicitation, or a recommendation to buy or sell any security.

---

## What Is LNZ?

LNZ ingests a weekly portfolio Excel file and live market data to produce:

- Portfolio metrics: alpha, rolling alpha, volatility, drawdown, beta
- Regime classification: Defensive / Recovery / Expansion / Neutral
- Deterministic, explainable rule-based recommendations (deployment tranches, profit-taking, risk control)
- Portfolio-relevant news and macro snapshots

No brokerage credentials. No automated trading. All recommendations include the rule triggers that generated them.

---

## Architecture

```
lnz/
├── apps/
│   ├── api/          FastAPI · Python · pandas · SQLAlchemy
│   └── web/          Next.js 14 App Router · TypeScript · Tailwind · Recharts
├── packages/
│   └── shared/       Shared TypeScript types
└── docker-compose.yml
```

---

## Quick Start

### Prerequisites

- Docker ≥ 24 and Docker Compose v2
- (Optional) Node 20+ and Python 3.12+ for local development without Docker

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env — especially SECRET_KEY and FILE_ENCRYPTION_KEY for production
```

### 2. Start all services

```bash
make dev
```

This starts:
| Service | URL |
|---------|-----|
| Next.js frontend | http://localhost:3000 |
| FastAPI backend | http://localhost:8000 |
| OpenAPI docs | http://localhost:8000/docs |
| Postgres | localhost:5432 |

### 3. Apply migrations

```bash
make migrate
```

### 4. Generate sample data

```bash
make seed
# Creates apps/api/uploads/sample_portfolio.xlsx
```

Then open http://localhost:3000/import and upload the generated file.

---

## Excel Template Format

Upload a `.xlsx` file with the following columns on the first sheet:

| Column | Type | Example | Notes |
|--------|------|---------|-------|
| `Date` | date | `2024-01-05` | mm/dd/yyyy or dd/mm/yyyy; configure in Import UI |
| `Total Value` | currency | `$125,000.00` | Dollar signs and commas are stripped |
| `Net Deposits` | currency | `$0.00` | Cumulative net capital invested |
| `Period Deposits` | currency | `$0.00` | Cash added/removed this period |
| `Period Return` | percent | `3.65%` | Portfolio return for the week |
| `SPY Period Return` | percent | `2.10%` | Benchmark (SPY) return for the week |

Additional columns are ignored. The app recomputes all derived metrics to avoid spreadsheet formula errors.

---

## Metrics Reference

| Metric | Formula |
|--------|---------|
| Weekly Alpha | `Rp(t) − Rb(t)` |
| Cumulative Alpha | `Σ Alpha(t)` |
| Rolling 4-week Alpha | `mean(Alpha, last 4)` |
| Rolling 8-week Volatility | `sample stdev(Rp, last 8)` |
| Running Peak | `max(Total Value, up to t)` |
| Drawdown | `(Total Value / Peak) − 1` |
| Max Drawdown | `min(Drawdown over all t)` |
| Rolling 12-week Beta | `cov(Rp,Rb) / var(Rb)` over last 12 weeks |
| Volatility Ratio | `stdev(Rp) / stdev(Rb)` over full sample |

---

## Regime Classification

Regimes are evaluated in priority order (Defensive > Recovery > Expansion):

| Regime | Conditions |
|--------|-----------|
| **Defensive** | Rolling 4w alpha < 0 AND drawdown ≤ −8% AND vol8 increasing |
| **Recovery** | Alpha4 improving 3 consecutive weeks AND drawdown improving AND vol8 stable/declining |
| **Expansion** | Alpha4 > 0 for 2 consecutive weeks AND drawdown ≥ −3% AND total value within 2% of peak |
| **Neutral** | None of the above match |

---

## Adding a Market/News Provider Adapter

1. Create a new file in `apps/api/app/providers/market/` (or `news/`)
2. Implement the `MarketDataProvider` (or `NewsProvider`) interface from `base.py`
3. Register your provider class in `apps/api/app/services/market_data.py` (or `news.py`) by adding a branch to `get_provider()`
4. Set `MARKET_DATA_PROVIDER=your_key` (or `NEWS_PROVIDER=your_key`) in `.env`

---

## Security Notes

- API keys are stored only in environment variables — never committed or persisted in the database
- Uploaded Excel files are AES-256 encrypted on disk using `FILE_ENCRYPTION_KEY`
- File uploads are validated: `.xlsx` only, max 10 MB
- CORS is restricted to `CORS_ORIGINS`; no direct external API calls from the browser
- All recommendation inputs, rule triggers, and outputs are logged in the `recommendations` table

---

## Make Targets

| Target | Description |
|--------|-------------|
| `make dev` | Start Docker Compose stack |
| `make test` | Run pytest |
| `make lint` | Ruff + ESLint |
| `make format` | Black + Ruff fix + Prettier |
| `make migrate` | Alembic upgrade head |
| `make makemigration name=label` | Generate new migration |
| `make seed` | Generate sample Excel |
| `make clean` | Destroy containers + volumes |
