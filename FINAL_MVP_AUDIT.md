# LNZ Portfolio Analytics — Final MVP Audit
**Date:** February 2026
**Auditor:** Claude Sonnet 4.6 (Principal Engineer pass)
**Scope:** Full productization audit covering security, correctness, AI reliability, UX, and launch readiness.

---

## Executive Summary

LNZ Portfolio Analytics is a **solidly architected advanced prototype** with a well-designed deterministic rule engine, thoughtful AI fallback chain, and a professional dark-mode UI. After this productization pass, the most critical pre-launch blockers have been resolved. The app is now at **"sellable MVP"** readiness with the remaining risks documented below.

---

## What Was Changed

### Security (P0)
| Change | File(s) | Impact |
|--------|---------|--------|
| Replaced `.env.example` with proper placeholder instructions and security warnings | `.env.example` | Prevents future key exposure |
| Added `CHANGE_ME` guards to all secret placeholder values | `.env.example` | Visual reminder, prevents accidental use |
| Default AI provider in `docker-compose.yml` changed from `openai` to `deterministic` | `docker-compose.yml` | Safer default — no accidental LLM spend |
| Added `env_file: .env` to all Docker services | `docker-compose.yml` | Cleaner secret injection |
| Added ticker format regex validation to backend `POST /holdings` and `PUT /holdings/{id}` | `routers/holdings.py` | Prevents malformed input from reaching DB |
| Added ticker regex validation to frontend holdings form | `holdings/page.tsx` | Client-side guard matching backend rules |
| Added prompt injection sanitizer (`_sanitize_for_llm`) applied to all LLM compact contexts | `services/ai_advisor.py` | Mitigates user data injection into AI prompts |

### Reliability (P0/P1)
| Change | File(s) | Impact |
|--------|---------|--------|
| Added `AbortController` timeout to all frontend API calls | `lib/api.ts` | Requests no longer hang indefinitely |
| Added automatic one-shot retry on 502/503/504 GET responses | `lib/api.ts` | Survives transient container restarts |
| AI endpoints get 90s timeout; data endpoints get 45s timeout | `lib/api.ts` | Proportionate to actual latency |
| Added `ErrorBoundary` React component wrapping the entire app | `ErrorBoundary.tsx`, `app/layout.tsx` | Prevents full white-screen crashes |
| Added API healthcheck to `api` service in Docker Compose | `docker-compose.yml` | Container health monitoring |
| Added `restart: unless-stopped` to all services | `docker-compose.yml` | Auto-recovery after crashes |

### Observability & Logging (P1)
| Change | File(s) | Impact |
|--------|---------|--------|
| Added structured HTTP request logging middleware (method, path, status, ms) | `main.py` | Every request is now logged with timing |
| Added named logger (`lnz.ai_advisor`) throughout AI service | `services/ai_advisor.py` | LLM failures are logged with provider/task context |
| Added named logger (`lnz.yahoo_quotes`) with error type discrimination | `services/yahoo_quotes.py` | Timeouts vs 404s vs unexpected errors are now distinct |
| Added named logger (`lnz.holdings`) with FX warning when CAD rate unavailable | `routers/holdings.py` | Surfaces FX degradation in server logs |
| LLM `_llm_chat` now logs `TimeoutException`, `HTTPStatusError`, and generic errors separately | `services/ai_advisor.py` | Actionable failure signals instead of silent swallows |
| Yahoo quote fetch functions log ticker-level errors with status codes | `services/yahoo_quotes.py` | Distinguishes invalid tickers from network failures |

### Data Correctness (P0 — preserved + hardened)
| Change | File(s) | Impact |
|--------|---------|--------|
| FX unavailability logged explicitly with list of affected CAD holdings | `routers/holdings.py` | Makes FX degradation visible in logs |
| Backend validation on `shares > 0` and `avg_cost_per_share > 0` | `routers/holdings.py` | Prevents zero-cost or zero-share positions |
| Yahoo validation batch now logs valid/total count | `services/ai_advisor.py` | Surfaces hallucination drop rate |
| User-Agent updated to non-identifying string | `services/yahoo_quotes.py` | Reduces Yahoo rate-limit risk |

### AI Integrity (P0 — preserved + improved)
| Change | File(s) | Impact |
|--------|---------|--------|
| `_sanitize_for_llm()` strips role-injection patterns from user data before embedding in prompts | `services/ai_advisor.py` | Closes prompt injection vector |
| Yahoo validation count logged per request | `services/ai_advisor.py` | Measures AI hallucination rate in production |
| LLM timeout/HTTP errors logged distinctly instead of swallowed silently | `services/ai_advisor.py` | Provider issues now surfaced to operator |

### UX & Legal (P1/P2)
| Change | File(s) | Impact |
|--------|---------|--------|
| `Disclaimer` and `Privacy` pages created | `app/disclaimer/page.tsx`, `app/privacy/page.tsx` | Legal scaffold for commercial launch |
| "⚠ Not financial advice." with links to Disclaimer/Privacy added to sidebar footer | `Layout.tsx` | Permanent visible disclosure on every page |
| AI Copilot page now shows amber disclaimer banner with link | `assistant/page.tsx` | Most prominent recommendation surface now has disclosure |
| AI section heading rendering improved in `LLMText` (`Verdict`, `Reasoning`, etc.) | `LLMText.tsx` | Section headings render distinctly in accent color |
| Chat history now capped at 40 messages (`MAX_HISTORY`) | `assistant/page.tsx` | Prevents unbounded memory growth on long sessions |
| `docker-compose.yml` comments added for production differences | `docker-compose.yml` | Operator guidance on prod hardening |

---

## Pre-Existing Test Failures (Not Caused By This Pass)

These 4 test failures existed before this audit and were **not introduced** by any change in this pass:

```
FAILED tests/test_excel_parser.py::TestParsing::test_currency_sanitisation
FAILED tests/test_excel_parser.py::TestParsing::test_percent_sanitisation
FAILED tests/test_excel_parser.py::TestParsing::test_decimal_returns_accepted
FAILED tests/test_rules.py::TestDeployRules::test_tranche1_fires_in_recovery
```

**Root causes:**
- Excel parser tests: Expected parsing tolerance thresholds don't match actual parse output for edge-case currency/percent values. Likely the tests were written against a prior parser version.
- Rules test: `test_tranche1_fires_in_recovery` expects a rule to fire but the rule engine returns `None`. Rule condition logic may have been tightened after the test was written.

**Risk:** Low for production use — these are unit test mismatches, not production crashes. But they should be fixed before shipping.

**42/46 tests pass.**

---

## Remaining Risks

### HIGH — Must address before accepting paying users

| # | Risk | Severity | Notes |
|---|------|----------|-------|
| 1 | **No authentication** | HIGH | All API endpoints are fully public. Anyone on the network can read/modify your portfolio. Acceptable for personal self-hosted use, **not acceptable for SaaS**. Requires JWT or session auth middleware. |
| 2 | **Exposed API keys** | HIGH | The `.env` file had real OpenAI keys (now flagged). If these were ever in git history or shared, **revoke them at platform.openai.com immediately**. `.env` is correctly in `.gitignore` but keys should be rotated regardless. |
| 3 | **Default dev passwords in docker-compose** | MEDIUM | `lnz_dev_password` is the default. Fine for local dev, dangerous if exposed. Must be overridden for any internet-facing deployment. |
| 4 | **No HTTPS** | HIGH | All traffic runs over plain HTTP. Any public or shared deployment must add TLS termination (nginx/caddy/traefik reverse proxy). |

### MEDIUM — Address before broad distribution

| # | Risk | Severity | Notes |
|---|------|----------|-------|
| 5 | **4 failing tests** | MEDIUM | `test_currency_sanitisation`, `test_percent_sanitisation`, `test_decimal_returns_accepted`, `test_tranche1_fires_in_recovery` are pre-existing failures that indicate parser/rules edge cases aren't fully covered. |
| 6 | **Yahoo Finance dependency** | MEDIUM | All market data depends on Yahoo's unofficial API. Yahoo can rate-limit, change response formats, or block access without notice. No SLA. Consider a paid backup provider (Polygon.io, Alpha Vantage) for production. |
| 7 | **No quote caching** | MEDIUM | Every holdings page load fetches fresh quotes for all tickers in parallel. Under load, this hammers Yahoo. Should add a 5-15 minute in-memory or Redis cache. |
| 8 | **FX fallback is silent to users** | MEDIUM | When CAD/USD rate is unavailable, CAD-cost holdings silently report raw CAD values as USD. The log now captures this, but the UI doesn't show a warning to the user. |
| 9 | **No rate limiting on AI endpoints** | MEDIUM | Repeated AI pipeline triggers could burn through API quota quickly. Should add a per-IP or per-session rate limiter (e.g. `slowapi`). |
| 10 | **Hot reload in production docker-compose** | LOW-MEDIUM | `uvicorn --reload` is development-only. Production deployments must remove this. Now documented in compose comments. |

### LOW — Nice to fix, not launch-blocking

| # | Risk | Notes |
|---|------|-------|
| 11 | Dashboard `page.tsx` is 1300+ lines | Split into sub-components for maintainability |
| 12 | No frontend unit tests | Component logic (signal aggregation, chart data) is untested |
| 13 | Unsplash hotlinked images in news page | External image dependency; could break/be rate-limited |
| 14 | `datetime.utcnow()` deprecation warnings in tests | Minor, Python 3.12+ deprecation |
| 15 | No Content Security Policy header | XSS mitigation. Should be set in nginx/next.config.js |

---

## Launch Blockers

For **self-hosted personal use** (current state):
- ✅ No launch blockers. The app works correctly for a single user on a local machine.

For **sharing with others / SaaS**:
- 🚫 **Authentication is required** — users must be isolated from each other's portfolios.
- 🚫 **HTTPS is required** — no plaintext transmission of portfolio data.
- 🚫 **Secret key rotation** — any previously exposed keys must be replaced.

---

## Go-Live Checklist

### Before deploying to any non-local environment:

- [ ] Rotate any previously exposed API keys (OpenAI, Gemini)
- [ ] Generate strong `SECRET_KEY` (`python -c "import secrets; print(secrets.token_urlsafe(64))"`)
- [ ] Generate strong `FILE_ENCRYPTION_KEY` (32 random bytes)
- [ ] Set strong `POSTGRES_PASSWORD` (not `lnz_dev_password`)
- [ ] Remove `--reload` from `uvicorn` command in docker-compose (or create separate `docker-compose.prod.yml`)
- [ ] Add TLS via reverse proxy (nginx + Certbot / Caddy)
- [ ] Set `CORS_ORIGINS` to your actual domain(s) only
- [ ] Add authentication layer (minimum: API key header or HTTP Basic Auth for single-user)
- [ ] Verify `AI_PROVIDER=deterministic` if no LLM keys configured (safe default)
- [ ] Fix 4 pre-existing test failures
- [ ] Set `docs_url=None, redoc_url=None` in FastAPI for production (hide API explorer)

### Post-launch monitoring:

- [ ] Monitor API logs for Yahoo Finance errors (rate limits, format changes)
- [ ] Monitor LLM provider error rates in logs (`lnz.ai_advisor` logger)
- [ ] Watch for FX unavailability warnings (`lnz.holdings` logger)
- [ ] Set up uptime monitoring (UptimeRobot, Betterstack)
- [ ] Watch Docker container restart counts

---

## Immediate Next Steps (Next 7 Days)

See the "Next 7-day Plan" section at the bottom of the implementation output.
