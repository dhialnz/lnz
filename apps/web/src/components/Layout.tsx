"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";

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
  const { currency, setCurrency, usdPerCad, rateLoading } = useCurrency();

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <aside className="relative w-[260px] shrink-0 hf-surface border-r border-border/80">
        <div className="absolute left-0 top-0 h-full w-[2px] bg-accent" />
        <div className="relative z-10 flex h-screen flex-col justify-between overflow-y-auto px-4 py-5">
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xl font-semibold tracking-[0.35em] text-white">LNZ</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2 py-1 text-[10px] font-medium text-positive">
                  <span className="h-1.5 w-1.5 rounded-full bg-positive hf-pulse-dot" />
                  LIVE
                </span>
              </div>
              <p className="text-[11px] text-muted">Portfolio Analytics Command</p>
            </div>

            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
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
                  <p className="text-[10px] text-muted">Live • 24 feeds active</p>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-muted">Analytics only. Not financial advice.</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="h-screen flex-1 overflow-y-auto">
        <div className="min-h-full px-8 py-6 hf-fade-up">{children}</div>
      </main>
    </div>
  );
}
