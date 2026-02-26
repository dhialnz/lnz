"use client";

import {
  getAIDashboardRecommendations,
  getAINewsSummary,
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

type RetryResult<T> = { ok: true; value: T } | { ok: false; error: string };

function toErrorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return "unknown error";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withRetries<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 900,
): Promise<RetryResult<T>> {
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await fn();
      return { ok: true, value };
    } catch (reason: unknown) {
      lastError = toErrorMessage(reason);
      if (attempt < attempts) {
        await sleep(baseDelayMs * attempt);
      }
    }
  }
  return { ok: false, error: lastError };
}

export async function startGlobalAIPrewarm(force = false): Promise<void> {
  if (!hasWindow()) return;
  const epoch = getAIEpoch();
  const doneKey = `${PREWARM_DONE_PREFIX}:e${epoch}`;
  if (!force && window.sessionStorage.getItem(doneKey) === "1") return;
  if (!force && prewarmPromise) return prewarmPromise;

  prewarmPromise = (async () => {
    // Force each run to prove all summaries again; done flag is only set on 3/3.
    window.sessionStorage.removeItem(doneKey);

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

    const patchState = (patch: Partial<AIPrewarmState>) => {
      writePrewarmState({
        ...readAIPrewarmState(),
        ...patch,
      });
    };

    const status = await getAIStatus().catch(() => null);
    if (!status?.ai_enabled) {
      setPuterAuthHint(false);
      patchState({
        ai_enabled: false,
        completed: false,
        last_error: "AI API disabled",
      });
      return;
    }
    setPuterAuthHint(true);
    patchState({
      ai_enabled: true,
      last_error: null,
    });

    let dashboardReady = false;
    let newsReady = false;
    let assistantReady = false;

    let dashboardError = "";
    let newsError = "";
    let assistantError = "";

    const maxRounds = 3;
    for (let round = 1; round <= maxRounds; round += 1) {
      const tasks: Promise<void>[] = [];

      if (!dashboardReady) {
        tasks.push(
          (async () => {
            const dashboard = await withRetries(() => getAIDashboardRecommendations(), 2, 700);
            if (dashboard.ok) {
              writeLatestDashboardRecommendations(dashboard.value.recommendations, dashboard.value.model);
              dashboardReady = true;
              dashboardError = "";
              return;
            }
            dashboardError = dashboard.error;
            const dashboardCached = readLatestDashboardRecommendations();
            dashboardReady = Boolean(
              dashboardCached &&
                Array.isArray(dashboardCached.recommendations) &&
                dashboardCached.recommendations.length > 0,
            );
          })(),
        );
      }

      if (!newsReady) {
        tasks.push(
          (async () => {
            const news = await withRetries(() => getAINewsSummary(), 2, 700);
            if (news.ok) {
              writeLatestNewsSummary(news.value.summary, news.value.model);
              newsReady = true;
              newsError = "";
              return;
            }
            newsError = news.error;
            const newsCached = readLatestNewsSummary();
            newsReady = Boolean(
              newsCached && typeof newsCached.text === "string" && newsCached.text.trim().length > 0,
            );
          })(),
        );
      }

      if (!assistantReady) {
        tasks.push(
          (async () => {
            const assistant = await withRetries(() => getPortfolioInsights(), 2, 700);
            if (assistant.ok) {
              writeLatestAssistantInsights(assistant.value, assistant.value.model);
              assistantReady = true;
              assistantError = "";
              return;
            }
            assistantError = assistant.error;
            const assistantCached = readLatestAssistantInsights();
            assistantReady = Boolean(
              assistantCached &&
                typeof assistantCached.summary === "string" &&
                assistantCached.summary.trim().length > 0,
            );
          })(),
        );
      }

      if (tasks.length > 0) {
        await Promise.all(tasks);
      }

      patchState({
        dashboard_ready: dashboardReady,
        news_ready: newsReady,
        assistant_ready: assistantReady,
        last_error:
          dashboardReady && newsReady && assistantReady
            ? null
            : `Retrying AI pipeline (${round}/${maxRounds})`,
      });

      if (dashboardReady && newsReady && assistantReady) break;
      if (round < maxRounds) await sleep(600 * round);
    }

    const errors: string[] = [];
    if (!dashboardReady) errors.push(`dashboard (${dashboardError || "failed"})`);
    if (!newsReady) errors.push(`news (${newsError || "failed"})`);
    if (!assistantReady) errors.push(`assistant (${assistantError || "failed"})`);

    patchState({
      ai_enabled: true,
      completed: true,
      dashboard_ready: dashboardReady,
      news_ready: newsReady,
      assistant_ready: assistantReady,
      completed_at: new Date().toISOString(),
      last_error: errors.length > 0 ? `Failed: ${errors.join(" | ")}` : null,
    });

    if (dashboardReady && newsReady && assistantReady) {
      window.sessionStorage.setItem(doneKey, "1");
    }
  })().finally(() => {
    prewarmPromise = null;
  });

  return prewarmPromise;
}
