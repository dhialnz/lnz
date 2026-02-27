# LNZ â€” Portfolio Analytics & AI Copilot

> **Not financial advice.** LNZ is an analytics and decision-support tool. Nothing it produces constitutes a solicitation or recommendation to buy or sell any security.

---

## What Is LNZ?

LNZ is a **portfolio intelligence platform** for serious self-directed investors. It gives individual investors the kind of analytics previously reserved for institutional desks â€” without the Bloomberg price tag.

**Core capabilities:**

| Feature | Description |
|---------|-------------|
| ðŸ“Š Weekly Alpha Tracking | Portfolio return vs SPY benchmark, every week |
| ðŸ› Regime Classification | Defensive / Recovery / Expansion / Neutral â€” rule-based, explainable |
| ðŸ¤– AI Portfolio Copilot | Portfolio-aware AI chat using your actual holdings as context |
| ðŸ“° News Impact Mapping | News events mapped to your specific holdings with sentiment scoring |
| âš¡ AI Catalyst Monitor | Real-time news catalyst aggregation per ticker |
| ðŸ“ˆ CNN Fear & Greed | Live market sentiment index on the dashboard |
| ðŸ’± CAD/USD Dual Currency | Full Canadian dollar support with live FX conversion |
| ðŸ“‹ Risk Rulebook | Personalized deployment / profit-taking / stop-loss thresholds |
| ðŸ“¥ Excel Import | Upload your weekly broker export â€” no brokerage API access required |

---

## Quick Start (Docker)

**Prerequisites:** Docker â‰¥ 24 and Docker Compose v2

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/lnz.git && cd lnz

# 2. Configure your environment
cp .env.example .env
# Edit .env â€” set SECRET_KEY, FILE_ENCRYPTION_KEY, and AI keys

# 3. Start all services
docker compose up --build -d

# 4. Open the app
open http://localhost:3000
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| API docs | http://localhost:8000/docs |
| Postgres | localhost:5432 |

---

## Deploying to Production (HTTPS)

```bash
# 1. Copy and fill in the production environment file
cp .env.prod.example .env
# Set LNZ_DOMAIN, strong POSTGRES_PASSWORD, SECRET_KEY, FILE_ENCRYPTION_KEY, AI keys

# 2. Point your domain's A record to this server

# 3. Launch with the production compose file
docker compose -f docker-compose.prod.yml up --build -d
```

Caddy handles **automatic HTTPS via Let's Encrypt** on first start. No manual certificate setup needed.

### Recommended Safe Deploy Command (VPS)

Use the deploy helper to avoid runtime build loops and repeated `502` after updates:

```bash
cd /opt/lnz
bash scripts/ops/deploy_prod.sh
```

### Production vs Development

| Feature | Dev (`docker-compose.yml`) | Prod (`docker-compose.prod.yml`) |
|---------|---------------------------|----------------------------------|
| API workers | 1, `--reload` | 2, no `--reload` |
| HTTPS | No | Yes (Caddy + Let's Encrypt) |
| API docs (`/docs`) | Visible | Hidden (`HIDE_DOCS=true`) |
| Source volume mounts | Yes (hot-reload) | No (image-baked code) |
| Postgres exposed | Yes (port 5432) | No (internal only) |

---

## Excel Import Format

Upload a `.xlsx` file with these columns on the first sheet:

| Column | Type | Example |
|--------|------|---------|
| `Date` | date | `01/05/2024` |
| `Total Value` | currency | `$125,000.00` |
| `Net Deposits` | currency | `$100,000.00` |
| `Period Deposits` | currency | `$0.00` |
| `Period Return` | percent | `3.65%` or `0.0365` |
| `SPY Period Return` | percent | `1.20%` or `0.012` |

`Net Deposits` and `Period Deposits` are optional â€” defaults to 0 if missing.

---

## AI Configuration

LNZ uses a provider chain: **Gemini â†’ OpenAI â†’ deterministic fallback**.

| `LNZ_AI_PROVIDER` value | Behaviour |
|------------------------|-----------|
| `auto` | Tries Gemini first, falls back to OpenAI, then deterministic |
| `gemini` | Gemini only |
| `openai` | OpenAI only |
| `deterministic` | No LLM calls â€” rule-based outputs only (safe default, free) |

Set in `.env`:
```env
LNZ_AI_PROVIDER=auto
LNZ_GEMINI_API_KEY=your-gemini-key
LNZ_OPENAI_API_KEY=your-openai-key
```

---

## Security

| Feature | Detail |
|---------|--------|
| **API Key Auth** | Set `LNZ_API_KEY` in `.env` to gate all endpoints behind a key |
| **HTTPS** | Caddy provides automatic TLS via Let's Encrypt in production |
| **Prompt injection protection** | User data is sanitised before embedding in LLM prompts |
| **File encryption** | Uploaded Excel files are AES-256 encrypted on disk |
| **Rate limiting** | AI endpoints are rate-limited per IP (default: 20 req/min) |
| **CORS** | Restricted to `CORS_ORIGINS` â€” no direct external browser API calls |

---

## Metrics Reference

| Metric | Formula |
|--------|---------|
| Weekly Alpha | `Rp(t) âˆ’ Rb(t)` |
| Cumulative Alpha | `Î£ Alpha(t)` |
| Rolling 4-week Alpha | `mean(Alpha, last 4)` |
| Rolling 8-week Volatility | `sample stdev(Rp, last 8)` |
| Running Peak | `max(Total Value, up to t)` |
| Drawdown | `(Total Value / Peak) âˆ’ 1` |
| Rolling 12-week Beta | `cov(Rp, Rb) / var(Rb)` over last 12 weeks |

---

## Regime Classification

| Regime | Conditions |
|--------|-----------|
| **Defensive** | Rolling 4w alpha < 0 AND drawdown â‰¤ âˆ’8% AND vol8 increasing |
| **Recovery** | Alpha4 improving 3 consecutive weeks AND drawdown improving AND vol8 stable/declining |
| **Expansion** | Alpha4 > 0 for 2 consecutive weeks AND drawdown â‰¥ âˆ’3% AND value within 2% of peak |
| **Neutral** | None of the above match |

---

## Architecture

```
lnz/
â”œâ”€â”€ apps/
â”‚   â”œâ”€â”€ api/          FastAPI Â· Python 3.12 Â· pandas Â· SQLAlchemy Â· PostgreSQL
â”‚   â””â”€â”€ web/          Next.js App Router Â· TypeScript Â· Tailwind CSS Â· Recharts
â”œâ”€â”€ docker-compose.yml          Development
â”œâ”€â”€ docker-compose.prod.yml     Production (Caddy HTTPS)
â”œâ”€â”€ Caddyfile                   Reverse proxy + TLS config
â””â”€â”€ .env.prod.example           Production env template
```

---

## License

Proprietary. All rights reserved unless otherwise agreed in writing.

---

> **Disclaimer:** LNZ is an analytics tool for informational purposes only. It is not a registered investment adviser. Past performance and AI signals are not indicators of future results. Always consult a qualified financial professional before making investment decisions.

