import type {
  AIChatMessage,
  AIChatResponse,
  AIDashboardRecommendations,
  AINewsSummary,
  AIStatus,
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

const AI_PATHS = ["/ai/chat", "/ai/portfolio-insights", "/ai/dashboard-recommendations", "/ai/news-summary"];

function getTimeoutMs(path: string): number {
  return AI_PATHS.some((p) => path.startsWith(p)) ? AI_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  _retries = 1,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs(path));

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      cache: method === "GET" ? "no-store" : init?.cache,
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: res.statusText }));
      // Retry once on 502/503/504 (transient gateway errors).
      if (_retries > 0 && [502, 503, 504].includes(res.status) && method === "GET") {
        await new Promise((r) => setTimeout(r, 1000));
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
  const res = await fetch(`${BASE_URL}/portfolio/preview-excel`, {
    method: "POST",
    body: form,
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
  const res = await fetch(`${BASE_URL}/portfolio/import-excel`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `Import error ${res.status}`);
  }
  return res.json();
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

