# LNZ Portfolio Analytics — Commercialization Plan
**Date:** February 2026
**Status:** Pre-launch planning document

---

## Product Positioning

**One-line pitch:**
> "The hedge-fund analytics dashboard for serious self-directed investors who want AI-powered portfolio intelligence — without the Bloomberg price tag."

**Core value proposition:**
LNZ gives individual investors and small family offices the kind of portfolio analytics previously reserved for institutional desks: weekly alpha tracking, risk regime classification, AI-driven news impact mapping, and a portfolio-aware AI copilot — all running on their own data, in their own environment.

**Key differentiators vs. competitors:**
| Dimension | LNZ | Robinhood/Wealthsimple | Sharesight | Koyfin |
|-----------|-----|------------------------|------------|--------|
| Weekly alpha vs SPY | ✅ | ❌ | ❌ | ❌ |
| Portfolio-aware AI copilot | ✅ | ❌ | ❌ | Partial |
| News impact mapped to your holdings | ✅ | ❌ | ❌ | ❌ |
| Risk rulebook / personalized thresholds | ✅ | ❌ | ❌ | ❌ |
| Self-hosted / privacy-first | ✅ | ❌ | ❌ | ❌ |
| CAD/USD dual-currency | ✅ | Partial | ✅ | Partial |
| Excel import for legacy portfolios | ✅ | ❌ | Partial | ❌ |
| Price | $0-Pro tier | Free | $13/mo | $49/mo |

---

## Ideal Customer Profile (ICP)

### Primary: The Serious DIY Investor
- **Demographics:** 28–55 years old, $50K–$2M invested
- **Behavior:** Actively manages their own portfolio, tracks performance weekly, follows financial news
- **Pain points:**
  - Brokerage apps show raw prices but no real analytics
  - No easy way to track alpha vs. market
  - Can't tie news events to their specific holdings
  - Wants AI analysis but doesn't want to manually paste data into ChatGPT
- **Willingness to pay:** $15–40/month for meaningful insight

### Secondary: Small Family Offices / Wealth Managers (Solo)
- **Demographics:** Managing $500K–$10M for 1–3 families
- **Behavior:** Weekly reporting, risk monitoring, evidence-based decisions
- **Pain points:**
  - Bloomberg/FactSet too expensive ($25K+/year)
  - Spreadsheets don't scale, lack analytics
  - Client-facing reporting needs polish
- **Willingness to pay:** $50–150/month

### Tertiary: Finance Students / CFA Candidates
- **Demographics:** 22–28 years old, smaller portfolios
- **Behavior:** Studying portfolio theory, want to apply it to real holdings
- **Willingness to pay:** Free or $5–10/month (student tier)

---

## Pricing & Packaging

### Recommended Tier Structure

**Free — "Observer"**
- Up to 5 holdings
- Weekly dashboard (deterministic metrics only, no AI)
- News flow (no AI summary)
- Risk playbook (read-only defaults)
- No AI copilot chat
- Self-hosted only
- *Goal: Land users, prove value*

**Pro — "Analyst" · $19/month (or $180/year = ~25% off)**
- Unlimited holdings
- Full weekly dashboard with AI recommendations
- AI copilot chat (unlimited queries)
- AI news impact summary
- AI portfolio insights + watchlist
- CAD/USD dual currency
- Excel import + manual week entry
- Risk quiz + custom rulebook
- Email support
- *Goal: Core revenue driver*

**Premium — "Command" · $49/month (or $468/year)**
- Everything in Pro
- Priority AI generation (faster models, e.g. GPT-4o vs mini)
- Multi-portfolio support (track 2–3 separate accounts)
- PDF weekly report export
- API access (read-only) for custom integrations
- Priority support with 24h response SLA
- Early access to new features
- *Goal: Power users and small family offices*

**Self-Hosted (MIT License core)**
- Free forever, open source
- User brings their own API keys
- Community support only
- *Goal: Distribution, developer trust, potential enterprise leads*

---

## Go-To-Market Strategy

### Phase 1: Organic Distribution (Month 1–3)
**Target:** First 100 users

1. **Reddit:** Post genuine demos in r/PersonalFinanceCanada, r/CanadianInvestor, r/ValueInvesting, r/financialindependence
   - Lead with the CAD analytics angle — rare in this space
   - Show the alpha tracking + news impact mapping in a short screen recording
   - Don't pitch directly; contribute to discussions, mention it naturally

2. **Twitter/X finance community:** Engage with DIY investor accounts, share weekly portfolio analytics screenshots (with your own anonymized portfolio)

3. **GitHub launch:** Clean README with screenshots, Docker one-liner setup
   - Submit to Hacker News "Show HN"
   - Post in r/selfhosted

4. **Product Hunt launch** (when UI is polished enough)
   - Target weekday 12:01AM PT launch
   - Pre-recruit upvoters from Reddit/Twitter community

### Phase 2: Content Marketing (Month 2–4)
**Target:** SEO traffic, credibility building

1. **Weekly "Portfolio Analytics" blog:**
   - "How I track my alpha vs SPY every week" (show LNZ)
   - "Why your brokerage app is lying to you about returns"
   - "How to read news impact on your holdings"

2. **YouTube shorts / Reels:** 60-second demos of specific features
   - "My portfolio's AI copilot told me to trim NVDA before it dropped"
   - Feature walkthroughs of dashboard, news, and assistant

3. **Newsletter:** Weekly market brief using LNZ's own output as a template

### Phase 3: Community & Retention (Month 3–6)
1. **Discord server:** Community for LNZ users to share portfolio insights
2. **Weekly portfolio template** (shareable format for social)
3. **Referral program:** One free month for each successful referral

### Top Acquisition Channels (Ranked by Expected ROI)
| # | Channel | Expected CPL | Time to results |
|---|---------|-------------|-----------------|
| 1 | Reddit (organic) | Free | 1–2 weeks |
| 2 | Hacker News Show HN | Free | Instant but volatile |
| 3 | GitHub + selfhosted communities | Free | 2–4 weeks |
| 4 | Product Hunt | Free | Launch day spike |
| 5 | Finance Twitter/X | Free | 4–8 weeks |
| 6 | YouTube tutorials | Free, time-intensive | 6–12 weeks |
| 7 | Google Ads (finance keywords) | $3–8 CPC | 2–4 weeks |

---

## Retention Loops

The product has strong natural retention mechanisms:

### Weekly Pull Loop
- Users import their weekly portfolio data → see dashboard → want to come back next week
- Weekly cadence matches natural investment review rhythm
- AI summary on Monday morning becomes a habit

### Data Investment Loop
- The more weeks of data uploaded, the richer the alpha tracking and regime history
- Users become invested in their historical data — high switching cost
- Rulebook + risk thresholds take time to calibrate

### AI Discovery Loop
- Every week brings new news events → new impact mappings → new AI insights
- Users discover unexpected connections (e.g., "AMZN news is impacting my ETF")
- AI copilot conversations that surprise users create word-of-mouth

### Comparison / Social Loop
- Future feature: portfolio comparison with anonymized benchmarks
- Shareable weekly "Portfolio Report" cards for social media

---

## Technical Debt Register

Items to address for sustainability (prioritized):

| Priority | Item | Effort | Risk if deferred |
|----------|------|--------|-----------------|
| P0 | Authentication (multi-user isolation) | 3–5 days | Can't accept paying users safely |
| P0 | Fix 4 failing unit tests | 2–4 hours | Parser edge cases may affect real data |
| P1 | Quote caching (5-15 min TTL) | 1 day | Yahoo rate limiting at scale |
| P1 | FX unavailability warning in UI | 2 hours | Users see wrong values silently |
| P1 | API rate limiting on AI endpoints | 4 hours | Cost overruns from repeated triggers |
| P2 | Split dashboard `page.tsx` (1300 lines) | 2 days | Maintainability, contributor experience |
| P2 | Frontend unit tests | 3–5 days | Risk of regressions in signal aggregation |
| P2 | Multi-portfolio support | 1 week | Required for Premium tier |
| P2 | PDF export | 3–5 days | Required for Premium tier |
| P3 | Replace Unsplash hotlinks with served images | 2 hours | External dependency brittleness |
| P3 | Content Security Policy headers | 2 hours | XSS hardening |
| P3 | Backup market data provider (Polygon.io) | 2–3 days | Yahoo dependency risk |

---

## Revenue Projections (Conservative)

Assuming self-hosted community drives discovery, converting to hosted Pro:

| Month | Free Users | Pro ($19) | Premium ($49) | MRR |
|-------|-----------|-----------|---------------|-----|
| 1 | 50 | 5 | 0 | $95 |
| 3 | 200 | 25 | 3 | $622 |
| 6 | 800 | 80 | 15 | $2,255 |
| 12 | 2,000 | 180 | 40 | $5,380 |

*Conservative: 5–10% free→paid conversion at 6 months*

**Path to $10K MRR:** ~450 Pro + 60 Premium users. Achievable in 12–18 months with consistent content distribution.

---

## Next 90 Days — Priority Roadmap

### Week 1–2: Launch Readiness
- [ ] Add authentication (minimum: single-user API key or magic link)
- [ ] Fix 4 failing tests
- [ ] Add FX warning banner in UI when CAD rate unavailable
- [ ] Deploy to a real server (VPS / Railway / Render)
- [ ] Add HTTPS (Caddy or Let's Encrypt)

### Week 3–4: Distribution
- [ ] Record 3-minute product demo video
- [ ] Write "Show HN" post draft
- [ ] Polish GitHub README (screenshots, one-liner Docker command)
- [ ] Soft-launch in 2–3 relevant Reddit communities

### Week 5–8: Core Product Hardening
- [ ] Add quote caching (5-min TTL, in-memory or Redis)
- [ ] Add API rate limiting on AI endpoints (`slowapi`)
- [ ] Split dashboard component into sub-components
- [ ] Add FX unavailability warning to UI

### Week 9–12: Monetization
- [ ] Add Stripe billing integration
- [ ] Implement feature flags for Free/Pro/Premium tiers
- [ ] Add holdings limit enforcement for Free tier
- [ ] Build PDF weekly report export
- [ ] Launch Product Hunt

---

*This plan is a living document. Update monthly as you gather real user feedback.*
