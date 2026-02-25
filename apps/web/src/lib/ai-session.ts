"use client";

import {
  getAIDashboardRecommendations,
  getAINewsSummary,
  getRecommendations,
  getAIStatus,
  getPortfolioInsights,
} from "@/lib/api";
import type { PortfolioInsights, Recommendation } from "@/lib/types";

const AUTH_HINT_KEY = "lnz_ai_enabled_hint_v1";
const AUTH_EVENT = "lnz:ai-enabled-changed";
const AI_EPOCH_KEY = "lnz_ai_epoch_v1";
const PREWARM_DONE_PREFIX = "lnz_ai_prewarm_done_v1";
const PREWARM_STATE_PREFIX = "lnz_ai_prewarm_state_v1";
const PREWARM_EVENT = "lnz:ai-prewarm-state";

const DASHBOARD_LATEST_PREFIX = "lnz_weekly_ai_recs_latest_v1";
const NEWS_LATEST_PREFIX = "lnz_news_ai_summary_latest_v1";
const ASSISTANT_LATEST_PREFIX = "lnz_assistant_insights_latest_v1";

export interface AIPrewarmState {
  epoch: number;
  started: boolean;
  completed: boolean;
  ai_enabled: boolean | null;
  dashboard_ready: boolean;
  news_ready: boolean;
  assistant_ready: boolean;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function readJson<T>(key: string): T | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!hasWindow()) return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures.
  }
}

function scopedKey(prefix: string): string {
  return `${prefix}:e${getAIEpoch()}`;
}

function defaultPrewarmState(): AIPrewarmState {
  return {
    epoch: getAIEpoch(),
    started: false,
    completed: false,
    ai_enabled: null,
    dashboard_ready: false,
    news_ready: false,
    assistant_ready: false,
    started_at: null,
    completed_at: null,
    last_error: null,
  };
}

function writePrewarmState(state: AIPrewarmState): void {
  writeJson(scopedKey(PREWARM_STATE_PREFIX), state);
  if (!hasWindow()) return;
  window.dispatchEvent(new CustomEvent(PREWARM_EVENT, { detail: state }));
}

export function readAIPrewarmState(): AIPrewarmState {
  return readJson<AIPrewarmState>(scopedKey(PREWARM_STATE_PREFIX)) ?? defaultPrewarmState();
}

export function subscribeAIPrewarm(listener: (state: AIPrewarmState) => void): () => void {
  if (!hasWindow()) return () => undefined;
  const handler = (event: Event) => {
    const custom = event as CustomEvent<AIPrewarmState>;
    listener(custom?.detail ?? readAIPrewarmState());
  };
  window.addEventListener(PREWARM_EVENT, handler as EventListener);
  return () => window.removeEventListener(PREWARM_EVENT, handler as EventListener);
}

export function getAIEpoch(): number {
  if (!hasWindow()) return 0;
  const raw = window.sessionStorage.getItem(AI_EPOCH_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export function bumpAIEpoch(): number {
  const next = getAIEpoch() + 1;
  if (hasWindow()) {
    window.sessionStorage.setItem(AI_EPOCH_KEY, String(next));
  }
  return next;
}

export function readPuterAuthHint(): boolean {
  if (!hasWindow()) return false;
  return window.sessionStorage.getItem(AUTH_HINT_KEY) === "1";
}

export function setPuterAuthHint(signedIn: boolean): void {
  if (!hasWindow()) return;
  window.sessionStorage.setItem(AUTH_HINT_KEY, signedIn ? "1" : "0");
  window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { signedIn } }));
}

export function subscribePuterAuth(listener: (signedIn: boolean) => void): () => void {
  if (!hasWindow()) return () => undefined;
  const handler = (event: Event) => {
    const custom = event as CustomEvent<{ signedIn?: boolean }>;
    const signedIn = custom?.detail?.signedIn;
    if (typeof signedIn === "boolean") {
      listener(signedIn);
      return;
    }
    listener(readPuterAuthHint());
  };
  window.addEventListener(AUTH_EVENT, handler as EventListener);
  return () => window.removeEventListener(AUTH_EVENT, handler as EventListener);
}

export async function syncPuterAuthFromClient(): Promise<{ client: null; signedIn: boolean }> {
  try {
    const status = await getAIStatus();
    const enabled = Boolean(status.ai_enabled);
    setPuterAuthHint(enabled);
    return { client: null, signedIn: enabled };
  } catch {
    setPuterAuthHint(false);
    return { client: null, signedIn: false };
  }
}

export function readLatestDashboardRecommendations(): { recommendations: Recommendation[]; model: string } | null {
  return readJson<{ recommendations: Recommendation[]; model: string }>(scopedKey(DASHBOARD_LATEST_PREFIX));
}

export function writeLatestDashboardRecommendations(recommendations: Recommendation[], model: string): void {
  writeJson(scopedKey(DASHBOARD_LATEST_PREFIX), { recommendations, model });
}

export function readLatestNewsSummary(): { text: string; model: string } | null {
  return readJson<{ text: string; model: string }>(scopedKey(NEWS_LATEST_PREFIX));
}

export function writeLatestNewsSummary(text: string, model: string): void {
  writeJson(scopedKey(NEWS_LATEST_PREFIX), { text, model });
}

export function readLatestAssistantInsights(): (PortfolioInsights & { model_used?: string }) | null {
  return readJson<PortfolioInsights & { model_used?: string }>(scopedKey(ASSISTANT_LATEST_PREFIX));
}

export function writeLatestAssistantInsights(insights: PortfolioInsights, modelUsed?: string): void {
  writeJson(scopedKey(ASSISTANT_LATEST_PREFIX), { ...insights, model_used: modelUsed ?? insights.model });
}

export function clearAIPipelineState(): void {
  if (!hasWindow()) return;
  const nextEpoch = bumpAIEpoch();
  prewarmPromise = null;

  const cleared: AIPrewarmState = {
    epoch: nextEpoch,
    started: false,
    completed: false,
    ai_enabled: null,
    dashboard_ready: false,
    news_ready: false,
    assistant_ready: false,
    started_at: null,
    completed_at: null,
    last_error: null,
  };

  writeJson(`${PREWARM_STATE_PREFIX}:e${nextEpoch}`, cleared);
  window.sessionStorage.removeItem(`${PREWARM_DONE_PREFIX}:e${nextEpoch}`);
  window.sessionStorage.removeItem(`${DASHBOARD_LATEST_PREFIX}:e${nextEpoch}`);
  window.sessionStorage.removeItem(`${NEWS_LATEST_PREFIX}:e${nextEpoch}`);
  window.sessionStorage.removeItem(`${ASSISTANT_LATEST_PREFIX}:e${nextEpoch}`);
  window.dispatchEvent(new CustomEvent(PREWARM_EVENT, { detail: cleared }));
}

let prewarmPromise: Promise<void> | null = null;

export async function startGlobalAIPrewarm(force = false): Promise<void> {
  if (!hasWindow()) return;
  const epoch = getAIEpoch();
  const doneKey = `${PREWARM_DONE_PREFIX}:e${epoch}`;
  if (!force && window.sessionStorage.getItem(doneKey) === "1") return;
  if (!force && prewarmPromise) return prewarmPromise;

  prewarmPromise = (async () => {
    const startedAt = new Date().toISOString();
    writePrewarmState({
      epoch,
      started: true,
      completed: false,
      ai_enabled: null,
      dashboard_ready: false,
      news_ready: false,
      assistant_ready: false,
      started_at: startedAt,
      completed_at: null,
      last_error: null,
    });

    const status = await getAIStatus().catch(() => null);
    if (!status?.ai_enabled) {
      setPuterAuthHint(false);
      writePrewarmState({
        ...readAIPrewarmState(),
        ai_enabled: false,
        completed: false,
        last_error: "AI API disabled",
      });
      return;
    }
    setPuterAuthHint(true);
    writePrewarmState({
      ...readAIPrewarmState(),
      ai_enabled: true,
      last_error: null,
    });

    const [dashboardFirst, news, assistant] = await Promise.allSettled([
      getAIDashboardRecommendations(),
      getAINewsSummary(),
      getPortfolioInsights(),
    ]);

    let dashboard: PromiseSettledResult<Awaited<ReturnType<typeof getAIDashboardRecommendations>>> = dashboardFirst;
    if (dashboard.status === "rejected") {
      // One immediate retry smooths over transient gateway/model blips.
      dashboard = await getAIDashboardRecommendations()
        .then((value) => ({ status: "fulfilled", value }) as const)
        .catch((reason) => ({ status: "rejected", reason }) as const);
    }

    if (dashboard.status === "fulfilled") {
      writeLatestDashboardRecommendations(dashboard.value.recommendations, dashboard.value.model);
    }
    if (news.status === "fulfilled") {
      writeLatestNewsSummary(news.value.summary, news.value.model);
    }
    if (assistant.status === "fulfilled") {
      writeLatestAssistantInsights(assistant.value, assistant.value.model);
    }

    const dashboardCached = readLatestDashboardRecommendations();
    let dashboardReady =
      dashboard.status === "fulfilled" ||
      Boolean(dashboardCached && Array.isArray(dashboardCached.recommendations) && dashboardCached.recommendations.length > 0);

    if (!dashboardReady) {
      const rulesFallback = await getRecommendations().catch(() => []);
      if (Array.isArray(rulesFallback) && rulesFallback.length > 0) {
        writeLatestDashboardRecommendations(rulesFallback, "rules-fallback");
        dashboardReady = true;
      }
    }
    const newsReady = news.status === "fulfilled";
    const assistantReady = assistant.status === "fulfilled";
    const errors: string[] = [];
    if (!dashboardReady) errors.push("dashboard");
    if (news.status === "rejected") errors.push("news");
    if (assistant.status === "rejected") errors.push("assistant");

    writePrewarmState({
      ...readAIPrewarmState(),
      ai_enabled: true,
      completed: true,
      dashboard_ready: dashboardReady,
      news_ready: newsReady,
      assistant_ready: assistantReady,
      completed_at: new Date().toISOString(),
      last_error: errors.length > 0 ? `Failed: ${errors.join(", ")}` : null,
    });

    if (dashboardReady && newsReady && assistantReady) {
      window.sessionStorage.setItem(doneKey, "1");
    }
  })().finally(() => {
    prewarmPromise = null;
  });

  return prewarmPromise;
}
