"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getAuthMe,
} from "@/lib/api";
import type { AuthMe } from "@/lib/types";

export default function BillingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authMe, setAuthMe] = useState<AuthMe | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [autoUpgradeHandled, setAutoUpgradeHandled] = useState(false);

  const tier = authMe?.tier ?? "observer";
  const requestedUpgradeTier = useMemo(() => {
    const raw = (searchParams.get("upgrade") || "").toLowerCase().trim();
    return raw === "analyst" || raw === "command" ? raw : null;
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const me = await getAuthMe();
        if (!cancelled) setAuthMe(me);
      } catch (err) {
        if (!cancelled) {
          setMessage(err instanceof Error ? err.message : "Failed loading billing profile.");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const startUpgradeCheckout = useCallback(async (targetTier: "analyst" | "command") => {
    setBusy(true);
    setMessage(null);
    window.location.assign(`/api/v1/billing/checkout-redirect?tier=${targetTier}`);
  }, []);

  useEffect(() => {
    if (autoUpgradeHandled) return;
    if (!authMe) return;
    if (!requestedUpgradeTier) return;

    const canUpgrade =
      (requestedUpgradeTier === "analyst" && tier === "observer") ||
      (requestedUpgradeTier === "command" &&
        (tier === "observer" || tier === "analyst"));

    setAutoUpgradeHandled(true);

    if (!canUpgrade) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("upgrade");
      const query = params.toString();
      router.replace(query ? `/billing?${query}` : "/billing");
      return;
    }

    void startUpgradeCheckout(requestedUpgradeTier);
  }, [
    authMe,
    autoUpgradeHandled,
    requestedUpgradeTier,
    router,
    searchParams,
    startUpgradeCheckout,
    tier,
  ]);

  const openBillingPortal = async () => {
    setBusy(true);
    setMessage(null);
    window.location.assign("/api/v1/billing/portal-redirect");
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-4xl leading-none font-serif tracking-tight text-white">Manage Plan</h1>
        <p className="text-xs font-mono text-muted mt-0.5">
          Upgrade, downgrade, or cancel your Stripe subscription.
        </p>
      </div>

      <div className="bg-panel border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-100">Current Tier</h2>
          <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs font-mono text-accent">
            {(tier || "observer").toUpperCase()}
          </span>
        </div>
        <div className="text-xs font-mono text-muted space-y-1">
          <p>`observer`: core portfolio tools + 1 free AI pipeline run.</p>
          <p>`analyst`: observer + AI endpoints (7-day trial for first subscription).</p>
          <p>`command`: analyst + multi-portfolio + weekly PDF export.</p>
        </div>
      </div>

      <div className="bg-panel border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-100">Plan Actions</h2>
          <span className="text-[11px] font-mono text-muted uppercase">Stripe</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {tier === "observer" ? (
            <>
              <button
                onClick={() => void startUpgradeCheckout("analyst")}
                disabled={busy}
                className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-mono text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                Start Analyst Trial (7 days)
              </button>
              <button
                onClick={() => void startUpgradeCheckout("command")}
                disabled={busy}
                className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-mono text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                Upgrade to Command ($49/mo)
              </button>
            </>
          ) : null}

          {tier === "analyst" ? (
            <button
              onClick={() => void startUpgradeCheckout("command")}
              disabled={busy}
              className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-mono text-accent transition hover:bg-accent/20 disabled:opacity-50"
            >
              Upgrade to Command ($49/mo)
            </button>
          ) : null}

          <button
            onClick={() => void openBillingPortal()}
            disabled={busy}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-neutral transition hover:border-accent/40 hover:text-white disabled:opacity-50"
          >
            Manage Existing Plan
          </button>
        </div>

        {message ? <p className="text-xs font-mono text-muted">{message}</p> : null}
      </div>
    </div>
  );
}
