import type {
  AIChatMessage,
  AIChatResponse,
  AIDashboardRecommendations,
  AINewsSummary,
  AIStatus,
  AuthMe,
  FearGreedData,
  PortfolioInsights,
  ImportResult,
  ClearImportedDataResult,
  HoldingIn,
  HoldingLive,
  HoldingsSnapshot,
  TickerSuggestion,
  ManualWeekEntryInput,
  ManualWeekEntryResult,
  SpyHistorySyncResult,
  MarketSnapshot,
  NewsEvent,
  NewsPortfolioImpact,
  ParsePreview,
  PortfolioActivateResult,
  PortfolioInfo,
  PortfolioSeriesRow,
  PortfolioSummary,
  Recommendation,
  RiskQuizInput,
  RiskQuizRecommendation,
  Rulebook,
} from "./types";

const BASE_URL = "/api/v1";

// Default request timeout — AI endpoints can take 30+ s, regular data calls
// should complete much faster.
const DEFAULT_TIMEOUT_MS = 45_000;
const AI_TIMEOUT_MS = 90_000;
const TOKEN_GETTER_WAIT_MS = 4_000;
const TOKEN_RESOLVE_TIMEOUT_MS = 5_000;
const SERVER_TOKEN_TIMEOUT_MS = 4_000;
const ACCESS_TOKEN_CACHE_MS = 20_000;
const TOKEN_MIN_TTL_SEC = 15;

// Clerk token getter — injected by ClerkApiSync on mount so this plain module
// can attach Authorization headers without importing React/Clerk hooks.
type TokenGetterOptions = { forceFresh?: boolean };
let _getToken: ((options?: TokenGetterOptions) => Promise<string | null>) | null = null;
let _cachedAccessToken: string | null = null;
let _cachedAccessTokenAt = 0;

export function setApiTokenGetter(
  fn: (options?: TokenGetterOptions) => Promise<string | null>,
): void {
  _getToken = fn;
}

function readCachedAccessToken(): string | null {
  if (!_cachedAccessToken) return null;
  if (Date.now() - _cachedAccessTokenAt > ACCESS_TOKEN_CACHE_MS) {
    _cachedAccessToken = null;
    _cachedAccessTokenAt = 0;
    return null;
  }
  if (isTokenExpiringSoon(_cachedAccessToken)) {
    _cachedAccessToken = null;
    _cachedAccessTokenAt = 0;
    return null;
  }
  return _cachedAccessToken;
}

function cacheAccessToken(token: string): void {
  if (isTokenExpiringSoon(token)) return;
  _cachedAccessToken = token;
  _cachedAccessTokenAt = Date.now();
}

function clearCachedAccessToken(): void {
  _cachedAccessToken = null;
  _cachedAccessTokenAt = 0;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadBase64.padEnd(payloadBase64.length + ((4 - (payloadBase64.length % 4)) % 4), "=");
    const raw = atob(padded);
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isTokenExpiringSoon(token: string, minTtlSeconds = TOKEN_MIN_TTL_SEC): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const exp = payload.exp;
  if (typeof exp !== "number") return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return exp - nowSec <= minTtlSeconds;
}

async function waitForTokenGetter(
  timeoutMs = TOKEN_GETTER_WAIT_MS,
): Promise<((options?: TokenGetterOptions) => Promise<string | null>) | null> {
  const started = Date.now();
  while (!_getToken && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return _getToken;
}

async function fetchServerAccessToken(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_TOKEN_TIMEOUT_MS);
  try {
    const res = await fetch("/api/auth/token", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const payload = (await res.json().catch(() => null)) as { token?: string | null } | null;
    const token = payload?.token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function shouldPreferFreshToken(path: string): boolean {
  return AI_PATHS.some((p) => path.startsWith(p));
}

async function resolveAccessToken(path: string, forceFresh = false): Promise<string | null> {
  const preferFresh = forceFresh || shouldPreferFreshToken(path);
  if (!preferFresh) {
    const cached = readCachedAccessToken();
    if (cached) return cached;
  }

  const getter = _getToken ?? (await waitForTokenGetter());
  if (getter) {
    try {
      const token = await Promise.race<string | null>([
        getter({ forceFresh: preferFresh }),
        new Promise<string | null>((resolve) => {
          setTimeout(() => resolve(null), TOKEN_RESOLVE_TIMEOUT_MS);
        }),
      ]);
      if (token) {
        const minTtl = preferFresh ? 30 : TOKEN_MIN_TTL_SEC;
        if (!isTokenExpiringSoon(token, minTtl)) {
          cacheAccessToken(token);
          return token;
        }
      }
    } catch {
      // Non-fatal: try server fallback below.
      console.warn(`[api] token getter failed for ${path}`);
    }
  }

  // Fallback: obtain token server-side via Clerk auth() in a Next route.
  const serverToken = await fetchServerAccessToken();
  if (serverToken) {
    const minTtl = preferFresh ? 30 : TOKEN_MIN_TTL_SEC;
    if (!isTokenExpiringSoon(serverToken, minTtl)) {
      cacheAccessToken(serverToken);
      return serverToken;
    }
  }

  return null;
}

const AI_PATHS = ["/ai/chat", "/ai/portfolio-insights", "/ai/dashboard-recommendations", "/ai/news-summary"];

function getTimeoutMs(path: string): number {
  return AI_PATHS.some((p) => path.startsWith(p)) ? AI_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  _retries = 2,
  _forceFreshToken = false,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs(path));

  try {
    const token = await resolveAccessToken(path, _forceFreshToken);
    const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${BASE_URL}${path}`, {
      cache: method === "GET" ? "no-store" : init?.cache,
      ...init,
      headers: { "Content-Type": "application/json", ...authHeader, ...init?.headers },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: res.statusText }));
      const detailText =
        typeof detail?.detail === "string" ? detail.detail.toLowerCase() : "";
      const isAuthFailure =
        [401, 403].includes(res.status) &&
        (detailText.includes("signature has expired") ||
          detailText.includes("invalid token") ||
          detailText.includes("missing authorization header") ||
          detailText.includes("missing auth token"));
      if (isAuthFailure) {
        clearCachedAccessToken();
        if (_retries > 0 && method === "GET") {
          await new Promise((r) => setTimeout(r, 300));
          return request<T>(path, init, _retries - 1, true);
        }
      }
      // Clerk cold-start can transiently yield 401/403 for a moment while
      // token/session state settles. Retry GET once before surfacing an error.
      if (_retries > 0 && [401, 403].includes(res.status) && method === "GET") {
        await new Promise((r) => setTimeout(r, 500));
        return request<T>(path, init, _retries - 1, true);
      }
      // Retry once on transient upstream/rate-limit errors.
      if (_retries > 0 && [408, 429, 502, 503, 504].includes(res.status) && method === "GET") {
        const retryAfterHeader = res.headers.get("Retry-After");
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
        const retryDelayMs = Number.isFinite(retryAfterSeconds) ? Math.max(500, retryAfterSeconds * 1000) : 1200;
        await new Promise((r) => setTimeout(r, retryDelayMs));
        return request<T>(path, init, _retries - 1);
      }
      throw new Error(detail?.detail ?? `API error ${res.status}`);
    }
    return res.json() as Promise<T>;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request timed out after ${getTimeoutMs(path) / 1000}s. Please try again.`);
    }
    throw err;
  }
}

// â”€â”€â”€ Portfolio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function getSummary(): Promise<PortfolioSummary> {
  return request<PortfolioSummary>("/portfolio/summary");
}

export async function getSeries(): Promise<PortfolioSeriesRow[]> {
  return request<PortfolioSeriesRow[]>("/portfolio/series");
}

export async function previewExcel(file: File): Promise<ParsePreview> {
  const form = new FormData();
  form.append("file", file);
  const token = await resolveAccessToken("/portfolio/preview-excel");
  const authHeader: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};
  const res = await fetch(`${BASE_URL}/portfolio/preview-excel`, {
    method: "POST",
    body: form,
    headers: authHeader,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `Upload error ${res.status}`);
  }
  return res.json();
}

export async function importExcel(
  file: File,
  dayfirst: boolean = false,
): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("dayfirst", String(dayfirst));
  const token = await resolveAccessToken("/portfolio/import-excel");
  const authHeader: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};
  const res = await fetch(`${BASE_URL}/portfolio/import-excel`, {
    method: "POST",
    body: form,
    headers: authHeader,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `Import error ${res.status}`);
  }
  return res.json();
}

export async function downloadImportTemplate(): Promise<Blob> {
  const path = "/portfolio/template.xlsx";
  const token = await resolveAccessToken(path);
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `Template download error ${res.status}`);
  }
  return res.blob();
}

export async function clearImportedData(): Promise<ClearImportedDataResult> {
  return request<ClearImportedDataResult>("/portfolio/imported-data", {
    method: "DELETE",
  });
}

export async function addManualWeek(
  payload: ManualWeekEntryInput,
): Promise<ManualWeekEntryResult> {
  return request<ManualWeekEntryResult>("/portfolio/manual-week", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function syncSpyHistory(): Promise<SpyHistorySyncResult> {
  return request<SpyHistorySyncResult>("/portfolio/sync-spy-history", {
    method: "POST",
  });
}

export async function getPortfolios(): Promise<PortfolioInfo[]> {
  return request<PortfolioInfo[]>("/portfolios");
}

export async function createPortfolio(name: string): Promise<PortfolioInfo> {
  return request<PortfolioInfo>("/portfolios", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function activatePortfolio(
  portfolioId: string,
): Promise<PortfolioActivateResult> {
  return request<PortfolioActivateResult>(`/portfolios/${portfolioId}/activate`, {
    method: "POST",
  });
}

export async function deletePortfolio(portfolioId: string): Promise<void> {
  await request<{ deleted: boolean }>(`/portfolios/${portfolioId}`, {
    method: "DELETE",
  });
}

export async function downloadWeeklyPdfReport(): Promise<Blob> {
  const path = "/reports/weekly.pdf";
  const token = await resolveAccessToken(path);
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `Report error ${res.status}`);
  }
  return res.blob();
}

// â”€â”€â”€ Recommendations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function getRecommendations(limit = 50): Promise<Recommendation[]> {
  return request<Recommendation[]>(`/recommendations?limit=${limit}`);
}

export async function runRecommendations(): Promise<Recommendation[]> {
  return request<Recommendation[]>("/recommendations/run", { method: "POST" });
}

// â”€â”€â”€ Market â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  return request<MarketSnapshot>("/market/snapshot");
}

export async function refreshMarketSnapshot(): Promise<MarketSnapshot> {
  return request<MarketSnapshot>("/market/refresh", { method: "POST" });
}

export async function getFearAndGreed(): Promise<FearGreedData> {
  return request<FearGreedData>("/market/fear-greed");
}

// â”€â”€â”€ News â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function getNewsEvents(params?: {
  entity?: string;
  event_type?: string;
  limit?: number;
}): Promise<NewsEvent[]> {
  const query = new URLSearchParams();
  if (params?.entity) query.set("entity", params.entity);
  if (params?.event_type) query.set("event_type", params.event_type);
  if (params?.limit) query.set("limit", String(params.limit));
  return request<NewsEvent[]>(`/news/events?${query.toString()}`);
}

export async function ingestNews(entities?: string[]): Promise<NewsEvent[]> {
  return request<NewsEvent[]>("/news/ingest", {
    method: "POST",
    body: JSON.stringify(entities ?? null),
  });
}

export async function getPortfolioNewsImpact(params?: {
  entity?: string;
  event_type?: string;
  limit?: number;
  refresh?: boolean;
}): Promise<NewsPortfolioImpact> {
  const query = new URLSearchParams();
  if (params?.entity) query.set("entity", params.entity);
  if (params?.event_type) query.set("event_type", params.event_type);
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.refresh) query.set("refresh", "true");
  return request<NewsPortfolioImpact>(`/news/portfolio-impact?${query.toString()}`);
}

// â”€â”€â”€ Holdings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function getHoldings(): Promise<HoldingsSnapshot> {
  return request<HoldingsSnapshot>("/holdings");
}

export async function addHolding(data: HoldingIn): Promise<HoldingLive> {
  return request<HoldingLive>("/holdings", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateHolding(
  id: string,
  data: HoldingIn,
): Promise<HoldingLive> {
  return request<HoldingLive>(`/holdings/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteHolding(id: string): Promise<void> {
  await request<{ deleted: boolean }>(`/holdings/${id}`, { method: "DELETE" });
}

export async function getTickerSuggestions(
  query: string,
  limit = 8,
): Promise<TickerSuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("limit", String(limit));
  return request<TickerSuggestion[]>(`/holdings/ticker-suggestions?${params.toString()}`);
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ AI Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export async function getAIStatus(): Promise<AIStatus> {
  return request<AIStatus>("/ai/status");
}

export async function getAuthMe(): Promise<AuthMe> {
  return request<AuthMe>("/auth/me");
}

export async function createBillingCheckoutSession(
  tier: "analyst" | "command",
): Promise<{ url: string }> {
  return request<{ url: string }>("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ tier }),
  });
}

export async function createBillingPortalSession(): Promise<{ url: string }> {
  return request<{ url: string }>("/billing/portal", {
    method: "POST",
  });
}

export async function getPortfolioInsights(): Promise<PortfolioInsights> {
  return request<PortfolioInsights>("/ai/portfolio-insights");
}

export async function chatAI(
  message: string,
  history: AIChatMessage[],
): Promise<AIChatResponse> {
  return request<AIChatResponse>("/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
}

export async function getAIDashboardRecommendations(): Promise<AIDashboardRecommendations> {
  return request<AIDashboardRecommendations>("/ai/dashboard-recommendations");
}

export async function getAINewsSummary(): Promise<AINewsSummary> {
  return request<AINewsSummary>("/ai/news-summary");
}

// â”€â”€â”€ Rulebook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function getRulebook(): Promise<Rulebook> {
  return request<Rulebook>("/rulebook");
}

export async function updateRulebook(
  payload: Partial<Pick<Rulebook, "thresholds" | "text">> & { replace_thresholds?: boolean },
): Promise<Rulebook> {
  return request<Rulebook>("/rulebook", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function recommendRulebookThresholds(
  payload: RiskQuizInput,
): Promise<RiskQuizRecommendation> {
  return request<RiskQuizRecommendation>("/rulebook/recommend-thresholds", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

