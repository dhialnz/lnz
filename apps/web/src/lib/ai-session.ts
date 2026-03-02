"use client";

import {
  getAIDashboardRecommendations,
  getAINewsSummary,
  getRecommendations,
  getAIStatus,
  getPortfolioInsights,
} from "@/lib/api";
import { sanitizePortfolioInsights } from "@/lib/ai-format";
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
// Keep these low: the backend now has a tight timeout (28s max) and no
// internal retry. Total worst-case pipeline time = MAX_ROUNDS × 3 stages ×
// backend_timeout. At 2 rounds × 3 × 28s = ~168s ≈ 2.8 min vs the old
// 6 rounds × 3 retries × 2 backend-attempts × 65s = ~23 minutes.
const PIPELINE_MAX_ROUNDS = 2;
const PIPELINE_STAGE_RETRIES = 2;
const PIPELINE_RETRY_BASE_DELAY_MS = 600;

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

function scopedKey(prefix: string, epoch = getAIEpoch()): string {
  return `${prefix}:e${epoch}`;
}

function defaultPrewarmState(epoch = getAIEpoch()): AIPrewarmState {
  return {
    epoch,
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

function writePrewarmState(state: AIPrewarmState, epoch = state.epoch): void {
  const normalized: AIPrewarmState = { ...state, epoch };
  writeJson(scopedKey(PREWARM_STATE_PREFIX, epoch), normalized);
  if (!hasWindow()) return;
  if (getAIEpoch() !== epoch) return;
  window.dispatchEvent(new CustomEvent(PREWARM_EVENT, { detail: normalized }));
}

export function readAIPrewarmState(epoch = getAIEpoch()): AIPrewarmState {
  return readJson<AIPrewarmState>(scopedKey(PREWARM_STATE_PREFIX, epoch)) ?? defaultPrewarmState(epoch);
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

export function readLatestDashboardRecommendations(
  epoch = getAIEpoch(),
): { recommendations: Recommendation[]; model: string } | null {
  return readJson<{ recommendations: Recommendation[]; model: string }>(scopedKey(DASHBOARD_LATEST_PREFIX, epoch));
}

export function writeLatestDashboardRecommendations(
  recommendations: Recommendation[],
  model: string,
  epoch = getAIEpoch(),
): void {
  writeJson(scopedKey(DASHBOARD_LATEST_PREFIX, epoch), { recommendations, model });
}

export function readLatestNewsSummary(epoch = getAIEpoch()): { text: string; model: string } | null {
  return readJson<{ text: string; model: string }>(scopedKey(NEWS_LATEST_PREFIX, epoch));
}

export function writeLatestNewsSummary(text: string, model: string, epoch = getAIEpoch()): void {
  writeJson(scopedKey(NEWS_LATEST_PREFIX, epoch), { text, model });
}

export function readLatestAssistantInsights(
  epoch = getAIEpoch(),
): (PortfolioInsights & { model_used?: string }) | null {
  return sanitizePortfolioInsights(
    readJson<PortfolioInsights & { model_used?: string }>(scopedKey(ASSISTANT_LATEST_PREFIX, epoch)),
  );
}

export function writeLatestAssistantInsights(
  insights: PortfolioInsights,
  modelUsed?: string,
  epoch = getAIEpoch(),
): void {
  const clean = sanitizePortfolioInsights({ ...insights, model_used: modelUsed ?? insights.model });
  if (!clean) return;
  writeJson(scopedKey(ASSISTANT_LATEST_PREFIX, epoch), clean);
}

export function clearAIPipelineState(): void {
  if (!hasWindow()) return;
  const nextEpoch = bumpAIEpoch();
  prewarmRunId += 1;
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
let prewarmRunId = 0;

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

async function requireAiOutput<T extends { used_ai: boolean; model?: string }>(
  fn: () => Promise<T>,
  stage: "dashboard" | "news" | "assistant",
): Promise<T> {
  const result = await fn();
  if (!result.used_ai) {
    throw new Error(
      `${stage} returned non-AI output (${result.model || "unknown model"})`,
    );
  }
  return result;
}

export async function startGlobalAIPrewarm(force = false): Promise<void> {
  if (!hasWindow()) return;
  const epoch = getAIEpoch();
  const doneKey = `${PREWARM_DONE_PREFIX}:e${epoch}`;
  if (!force && window.sessionStorage.getItem(doneKey) === "1") return;
  // Never allow overlapping prewarm runs; overlapping writes can leave the
  // sidebar state stuck in partial/invalid transitions.
  if (prewarmPromise) return prewarmPromise;
  // Only increment runId when we are actually starting a new run.
  // Incrementing on every call (including ones that return early via the
  // prewarmPromise guard above) causes the finally-block check to always
  // fail, leaving prewarmPromise permanently pointing at a stale resolved
  // promise and silently blocking all future pipeline starts.
  const runId = ++prewarmRunId;

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
        ...readAIPrewarmState(epoch),
        ...patch,
      }, epoch);
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

    // Consume observer free-run entitlement exactly once per pipeline run.
    // Backend interprets X-LNZ-AI-Pipeline as the start signal.
    const seededDashboard = await withRetries(
      () =>
        requireAiOutput(
          () => getAIDashboardRecommendations({ pipeline: true }),
          "dashboard",
        ),
      PIPELINE_STAGE_RETRIES,
      PIPELINE_RETRY_BASE_DELAY_MS,
    );
    if (seededDashboard.ok) {
      writeLatestDashboardRecommendations(
        seededDashboard.value.recommendations,
        seededDashboard.value.model,
        epoch,
      );
      dashboardReady = true;
    } else {
      // Observer retry path: if free run was already consumed, the backend
      // rejects a second "start" header. Retry once without the pipeline
      // header so an in-window retry can complete.
      const lowerSeedError = seededDashboard.error.toLowerCase();
      const shouldRetryWithoutStartHeader =
        lowerSeedError.includes("already used") ||
        lowerSeedError.includes("free ai pipeline run");
      if (shouldRetryWithoutStartHeader) {
        const seededDashboardRetry = await withRetries(
          () =>
            requireAiOutput(
              () => getAIDashboardRecommendations(),
              "dashboard",
            ),
          PIPELINE_STAGE_RETRIES,
          PIPELINE_RETRY_BASE_DELAY_MS,
        );
        if (seededDashboardRetry.ok) {
          writeLatestDashboardRecommendations(
            seededDashboardRetry.value.recommendations,
            seededDashboardRetry.value.model,
            epoch,
          );
          dashboardReady = true;
        } else {
          dashboardError = seededDashboardRetry.error;
        }
      } else {
        dashboardError = seededDashboard.error;
      }
    }

    const maxRounds = PIPELINE_MAX_ROUNDS;
    for (let round = 1; round <= maxRounds; round += 1) {
      const stageTasks: Promise<void>[] = [];

      if (!dashboardReady) {
        stageTasks.push((async () => {
          const dashboard = await withRetries(
            () =>
              requireAiOutput(
                () => getAIDashboardRecommendations(),
                "dashboard",
              ),
            PIPELINE_STAGE_RETRIES,
            PIPELINE_RETRY_BASE_DELAY_MS,
          );
          if (dashboard.ok) {
            writeLatestDashboardRecommendations(dashboard.value.recommendations, dashboard.value.model, epoch);
            dashboardReady = true;
            dashboardError = "";
          } else {
            dashboardError = dashboard.error;
          }

          const dashboardCached = readLatestDashboardRecommendations(epoch);
          dashboardReady = Boolean(
            dashboardCached &&
              Array.isArray(dashboardCached.recommendations) &&
              dashboardCached.recommendations.length > 0 &&
              dashboardCached.model !== "deterministic-v1" &&
              dashboardCached.model !== "rules-fallback",
          );

          if (!dashboardReady) {
            const rulesFallback = await withRetries(() => getRecommendations(), 1, 600);
            if (rulesFallback.ok && Array.isArray(rulesFallback.value) && rulesFallback.value.length > 0) {
              writeLatestDashboardRecommendations(rulesFallback.value, "rules-fallback", epoch);
            } else if (!rulesFallback.ok) {
              dashboardError = `${dashboardError}; fallback: ${rulesFallback.error}`;
            }
          }
        })());
      }

      if (!newsReady) {
        stageTasks.push((async () => {
          const news = await withRetries(
            () =>
              requireAiOutput(
                () => getAINewsSummary(),
                "news",
              ),
            PIPELINE_STAGE_RETRIES,
            PIPELINE_RETRY_BASE_DELAY_MS,
          );
          if (news.ok) {
            writeLatestNewsSummary(news.value.summary, news.value.model, epoch);
            newsReady = true;
            newsError = "";
          } else {
            newsError = news.error;
          }
          const newsCached = readLatestNewsSummary(epoch);
          newsReady = Boolean(
            newsCached &&
              typeof newsCached.text === "string" &&
              newsCached.text.trim().length > 0 &&
              newsCached.model !== "deterministic-v1",
          );
        })());
      }

      if (!assistantReady) {
        stageTasks.push((async () => {
          const assistant = await withRetries(
            () =>
              requireAiOutput(
                () => getPortfolioInsights(),
                "assistant",
              ),
            PIPELINE_STAGE_RETRIES,
            PIPELINE_RETRY_BASE_DELAY_MS,
          );
          if (assistant.ok) {
            writeLatestAssistantInsights(assistant.value, assistant.value.model, epoch);
            assistantReady = true;
            assistantError = "";
          } else {
            assistantError = assistant.error;
          }
          const assistantCached = readLatestAssistantInsights(epoch);
          assistantReady = Boolean(
            assistantCached &&
              typeof assistantCached.summary === "string" &&
              assistantCached.summary.trim().length > 0 &&
              assistantCached.model !== "deterministic-v1",
          );
        })());
      }

      if (stageTasks.length > 0) {
        await Promise.all(stageTasks);
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
      if (round < maxRounds) await sleep(3000);
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
    if (prewarmRunId === runId) {
      prewarmPromise = null;
    }
  });

  return prewarmPromise;
}
