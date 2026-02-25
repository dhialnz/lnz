"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  clearAIPipelineState,
  readAIPrewarmState,
  startGlobalAIPrewarm,
  subscribeAIPrewarm,
  type AIPrewarmState,
} from "@/lib/ai-session";

type IconName =
  | "dashboard"
  | "chart"
  | "briefcase"
  | "table"
  | "upload"
  | "shield"
  | "news"
  | "sparkles"
  | "settings";

const NAV_ITEMS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "Weekly Dashboard", icon: "dashboard" },
  { href: "/holdings", label: "Holdings", icon: "briefcase" },
  { href: "/news", label: "News Flow", icon: "news" },
  { href: "/assistant", label: "AI Copilot", icon: "sparkles" },
  { href: "/data", label: "Data Grid", icon: "table" },
  { href: "/import", label: "Upload Data", icon: "upload" },
  { href: "/rulebook", label: "Risk Playbook", icon: "shield" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function IconGlyph({ name, active }: { name: IconName; active: boolean }) {
  const stroke = active ? "#FF5C00" : "#6B6B70";

  const d: Record<IconName, string> = {
    dashboard: "M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 14h7v7H3z",
    chart: "M4 20V10m6 10V6m6 14v-8m6 8V4",
    briefcase: "M3 8h18v11H3zM8 8V5h8v3",
    table: "M3 5h18v14H3zM3 10h18M9 5v14M15 5v14",
    upload: "M12 16V4m0 0-4 4m4-4 4 4M4 18h16",
    shield: "M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z",
    news: "M4 5h13v14H4zM8 9h5M8 12h5M8 15h5M17 7h3v12h-3",
    sparkles:
      "M12 3l1.5 3.5L17 8l-3.5 1.5L12 13l-1.5-3.5L7 8l3.5-1.5zM5 14l.8 1.8L7.5 17l-1.7.7L5 19.5l-.8-1.8L2.5 17l1.7-.7zM18 14l.8 1.8 1.7.7-1.7.7-.8 1.8-.8-1.8-1.7-.7 1.7-.7z",
    settings:
      "M12 3v3m0 12v3m9-9h-3M6 12H3m15.4 6.4-2.1-2.1M7.7 7.7 5.6 5.6m12.8 0-2.1 2.1M7.7 16.3l-2.1 2.1M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
  };

  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8">
      <path d={d[name]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { currency, setCurrency, usdPerCad, rateLoading } = useCurrency();
  const [aiPrewarm, setAiPrewarm] = useState<AIPrewarmState>({
    epoch: 0,
    started: false,
    completed: false,
    ai_enabled: null,
    dashboard_ready: false,
    news_ready: false,
    assistant_ready: false,
    started_at: null,
    completed_at: null,
    last_error: null,
  });
  const [aiPipelineBusy, setAiPipelineBusy] = useState(false);

  useEffect(() => {
    const sync = () => setAiPrewarm(readAIPrewarmState());
    sync();
    const unsubscribe = subscribeAIPrewarm(setAiPrewarm);
    return unsubscribe;
  }, []);

  const aiReadyCount = [aiPrewarm.dashboard_ready, aiPrewarm.news_ready, aiPrewarm.assistant_ready].filter(Boolean).length;
  const aiStatusLabel = useMemo(() => {
    if (aiPrewarm.ai_enabled === false) return "AI Offline";
    if (!aiPrewarm.started) return "AI Idle";
    if (!aiPrewarm.completed) return "AI Warming";
    if (aiReadyCount === 3) return "AI Ready";
    return "AI Partial";
  }, [aiPrewarm.ai_enabled, aiPrewarm.completed, aiPrewarm.started, aiReadyCount]);
  const aiProgressPct = Math.min(100, Math.max(0, Math.round((aiReadyCount / 3) * 100)));

  const handleStartPipeline = async () => {
    if (aiPipelineBusy) return;
    setAiPipelineBusy(true);
    try {
      // Force avoids stale "done" flags causing a no-op.
      await startGlobalAIPrewarm(true);
    } finally {
      setAiPipelineBusy(false);
    }
  };

  const handleClearPipeline = () => {
    if (aiPipelineBusy) return;
    clearAIPipelineState();
    setAiPrewarm(readAIPrewarmState());
  };

  const handleNavClick = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    // Let browser handle new-tab/new-window gestures.
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    if (pathname === href) return;
    event.preventDefault();
    router.push(href);
    // Fallback to full page nav if client transition stalls.
    window.setTimeout(() => {
      if (window.location.pathname !== href) {
        window.location.assign(href);
      }
    }, 350);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <aside className="relative z-40 w-[260px] shrink-0 hf-surface border-r border-border/80">
        <div className="absolute left-0 top-0 h-full w-[2px] bg-accent" />
        <div className="relative z-10 flex h-screen flex-col justify-between overflow-y-auto px-4 py-5">
          <div className="space-y-5">
            <div className="rounded-xl border border-border/80 bg-gradient-to-br from-[#11151e] via-[#111117] to-[#0f1116] p-3 shadow-[0_8px_22px_rgba(0,0,0,0.35)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-accent/40 bg-accent/10">
                    <span className="text-[11px] font-semibold tracking-[0.15em] text-accent">L</span>
                    <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent/80 shadow-[0_0_12px_rgba(255,92,0,0.65)]" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="font-serif text-[19px] leading-none tracking-[0.26em] text-white">LNZ</p>
                    <p className="text-[9px] font-mono uppercase tracking-[0.24em] text-accent/80">Alpha Desk</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2 py-1 text-[10px] font-medium text-positive">
                  <span className="h-1.5 w-1.5 rounded-full bg-positive hf-pulse-dot" />
                  LIVE
                </span>
              </div>
              <p className="mt-2 text-[11px] text-muted">Portfolio Intelligence Terminal</p>
            </div>

            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={handleNavClick(item.href)}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200",
                      active
                        ? "bg-white/[0.04] text-white"
                        : "text-[#8B8B90] hover:bg-white/[0.02] hover:text-[#CFCFD2]",
                    )}
                  >
                    <IconGlyph name={item.icon} active={active} />
                    <span className={cn("truncate", active ? "font-medium" : "font-normal")}>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="rounded-xl border border-border/80 bg-[#101013] p-3 space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted">AI Pipeline</p>
              <div className={cn("flex items-center justify-between rounded-md px-1", aiPipelineBusy ? "bg-accent/10" : "")}>
                <span className="text-xs font-mono text-white">{aiStatusLabel}</span>
                {!aiPrewarm.completed && aiPrewarm.started ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce" />
                  </span>
                ) : (
                  <span className={cn("h-2 w-2 rounded-full", aiReadyCount === 3 ? "bg-positive" : "bg-caution")} />
                )}
              </div>
              <p className="text-[10px] font-mono text-muted">{aiReadyCount}/3 summaries primed</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#1b1b1f]">
                <div
                  className={cn(
                    "h-full rounded-full bg-accent transition-all duration-500",
                    aiPipelineBusy ? "animate-pulse" : "",
                  )}
                  style={{ width: `${aiProgressPct}%` }}
                />
              </div>
              <p className="text-[10px] font-mono text-muted">
                {aiPipelineBusy
                  ? "Pipeline requested... generating dashboard, news, and assistant summaries."
                  : aiPrewarm.started
                    ? aiPrewarm.completed
                      ? "Pipeline completed. Use restart to regenerate all summaries."
                      : "Pipeline running..."
                    : "Press start to run AI summaries in the background."}
              </p>
              <button
                onClick={() => void handleStartPipeline()}
                disabled={aiPipelineBusy}
                className="w-full rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] font-mono text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                {aiPipelineBusy ? "Pipeline Running..." : aiPrewarm.started ? "Restart AI Pipeline" : "Start AI Pipeline"}
              </button>
              <button
                onClick={handleClearPipeline}
                disabled={aiPipelineBusy}
                className="w-full rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-mono text-muted transition hover:bg-white/[0.03] disabled:opacity-50"
              >
                Clear AI Pipeline
              </button>
            </div>

            <div className="rounded-xl border border-border/80 bg-[#101013] p-3 space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted">Currency</p>
              <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border">
                <button
                  onClick={() => setCurrency("CAD")}
                  className={cn(
                    "py-1.5 text-xs font-mono transition-colors",
                    currency === "CAD" ? "bg-accent text-white" : "text-[#8B8B90] hover:bg-white/[0.03]",
                  )}
                >
                  CAD
                </button>
                <button
                  onClick={() => setCurrency("USD")}
                  className={cn(
                    "py-1.5 text-xs font-mono transition-colors",
                    currency === "USD" ? "bg-accent text-white" : "text-[#8B8B90] hover:bg-white/[0.03]",
                  )}
                >
                  USD
                </button>
              </div>
              {!rateLoading && usdPerCad != null && (
                <p className="text-[10px] font-mono text-muted">1 CAD = {usdPerCad.toFixed(4)} USD</p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="border-t border-border pt-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2A2A2E] text-[11px] font-semibold text-[#8B8B90]">
                  DR
                </div>
                <div>
                  <p className="text-xs text-white">Dhiaa Risk Desk</p>
                  <p className="text-[10px] text-muted">Live intelligence</p>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-muted font-semibold text-amber-500/80">
                ! Not financial advice.
              </p>
              <div className="mt-1.5 flex gap-2 text-[10px] text-muted">
                <Link href="/disclaimer" className="hover:text-white transition">Disclaimer</Link>
                <span>|</span>
                <Link href="/privacy" className="hover:text-white transition">Privacy</Link>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="relative z-0 h-screen flex-1 overflow-y-auto min-w-0">
        <ErrorBoundary key={pathname}>
          <div className="min-h-full px-8 py-6 hf-fade-up">{children}</div>
        </ErrorBoundary>
      </main>
    </div>
  );
}
