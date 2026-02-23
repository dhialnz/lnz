import type {
  ImportResult,
  MarketSnapshot,
  NewsEvent,
  ParsePreview,
  PortfolioSeriesRow,
  PortfolioSummary,
  Recommendation,
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

// ─── Portfolio ─────────────────────────────────────────────────────────────────

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

// ─── Recommendations ───────────────────────────────────────────────────────────

export async function getRecommendations(limit = 50): Promise<Recommendation[]> {
  return request<Recommendation[]>(`/recommendations?limit=${limit}`);
}

export async function runRecommendations(): Promise<Recommendation[]> {
  return request<Recommendation[]>("/recommendations/run", { method: "POST" });
}

// ─── Market ────────────────────────────────────────────────────────────────────

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  return request<MarketSnapshot>("/market/snapshot");
}

export async function refreshMarketSnapshot(): Promise<MarketSnapshot> {
  return request<MarketSnapshot>("/market/refresh", { method: "POST" });
}

// ─── News ──────────────────────────────────────────────────────────────────────

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

// ─── Rulebook ──────────────────────────────────────────────────────────────────

export async function getRulebook(): Promise<Rulebook> {
  return request<Rulebook>("/rulebook");
}

export async function updateRulebook(
  payload: Partial<Pick<Rulebook, "thresholds" | "text">>,
): Promise<Rulebook> {
  return request<Rulebook>("/rulebook", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
