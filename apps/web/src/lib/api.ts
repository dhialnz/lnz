import type {
  AIChatMessage,
  AIChatResponse,
  AIDashboardRecommendations,
  AINewsSummary,
  AIStatus,
  PortfolioInsights,
  ImportResult,
  ClearImportedDataResult,
  HoldingIn,
  HoldingLive,
  HoldingsSnapshot,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
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

