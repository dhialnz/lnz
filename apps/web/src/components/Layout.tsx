"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "▦" },
  { href: "/import", label: "Import", icon: "⬆" },
  { href: "/benchmark", label: "Benchmark", icon: "≈" },
  { href: "/rulebook", label: "Rulebook", icon: "⚖" },
  { href: "/news", label: "News", icon: "◉" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 bg-panel border-r border-border flex flex-col">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-border">
          <span className="font-mono text-lg font-semibold text-accent tracking-widest">
            LNZ
          </span>
          <p className="text-xs text-muted mt-0.5 font-mono">Portfolio Analytics</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
                  active
                    ? "bg-accent/10 text-accent font-medium"
                    : "text-muted hover:text-gray-200 hover:bg-white/5",
                )}
              >
                <span className="font-mono text-xs w-4 text-center opacity-70">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border">
          <p className="text-xs text-muted font-mono leading-relaxed">
            Analytics only.
            <br />
            Not financial advice.
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="min-h-full p-6">{children}</div>
      </main>
    </div>
  );
}
