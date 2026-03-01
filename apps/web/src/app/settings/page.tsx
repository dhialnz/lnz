"use client";

import { useEffect, useMemo, useState } from "react";
import {
  activatePortfolio,
  createBillingCheckoutSession,
  createBillingPortalSession,
  createPortfolio,
  deletePortfolio,
  downloadWeeklyPdfReport,
  getAuthMe,
  getPortfolios,
} from "@/lib/api";
import type { AuthMe, PortfolioInfo } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

export default function SettingsPage() {
  const [authMe, setAuthMe] = useState<AuthMe | null>(null);
  const [portfolios, setPortfolios] = useState<PortfolioInfo[]>([]);
  const [portfoliosLoading, setPortfoliosLoading] = useState(false);
  const [portfolioActionBusy, setPortfolioActionBusy] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [portfolioMessage, setPortfolioMessage] = useState<string | null>(null);

  const [downloadingReport, setDownloadingReport] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);

  const tier = authMe?.tier ?? "observer";
  const isCommand = tier === "command";
  const activePortfolio = useMemo(
    () => portfolios.find((p) => p.is_active) ?? null,
    [portfolios],
  );

  const loadAuthAndPortfolios = async () => {
    try {
      const me = await getAuthMe();
      setAuthMe(me);
      setPortfoliosLoading(true);
      const rows = await getPortfolios();
      setPortfolios(rows);
    } catch (err) {
      setPortfolioMessage(err instanceof Error ? err.message : "Failed loading account info.");
    } finally {
      setPortfoliosLoading(false);
    }
  };

  useEffect(() => {
    void loadAuthAndPortfolios();
  }, []);

  const handleCreatePortfolio = async () => {
    const name = newPortfolioName.trim();
    if (!name) {
      setPortfolioMessage("Portfolio name cannot be empty.");
      return;
    }
    setPortfolioActionBusy(true);
    setPortfolioMessage(null);
    try {
      await createPortfolio(name);
      setNewPortfolioName("");
      await loadAuthAndPortfolios();
      setPortfolioMessage(`Portfolio "${name}" created.`);
    } catch (err) {
      setPortfolioMessage(err instanceof Error ? err.message : "Create failed");
    } finally {
      setPortfolioActionBusy(false);
    }
  };

  const handleActivatePortfolio = async (portfolioId: string, portfolioName: string) => {
    setPortfolioActionBusy(true);
    setPortfolioMessage(null);
    try {
      await activatePortfolio(portfolioId);
      await loadAuthAndPortfolios();
      setPortfolioMessage(`Active portfolio set to "${portfolioName}".`);
    } catch (err) {
      setPortfolioMessage(err instanceof Error ? err.message : "Activate failed");
    } finally {
      setPortfolioActionBusy(false);
    }
  };

  const handleDeletePortfolio = async (portfolioId: string, portfolioName: string) => {
    const ok = window.confirm(
      `Delete portfolio "${portfolioName}"? This removes access to its stored rows.`,
    );
    if (!ok) return;
    setPortfolioActionBusy(true);
    setPortfolioMessage(null);
    try {
      await deletePortfolio(portfolioId);
      await loadAuthAndPortfolios();
      setPortfolioMessage(`Portfolio "${portfolioName}" deleted.`);
    } catch (err) {
      setPortfolioMessage(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setPortfolioActionBusy(false);
    }
  };

  const handleDownloadWeeklyPdf = async () => {
    setDownloadingReport(true);
    setPortfolioMessage(null);
    try {
      const blob = await downloadWeeklyPdfReport();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "alphenzi-weekly-report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPortfolioMessage("Weekly report downloaded.");
    } catch (err) {
      setPortfolioMessage(err instanceof Error ? err.message : "Report download failed.");
    } finally {
      setDownloadingReport(false);
    }
  };

  const handleUpgrade = async (targetTier: "analyst" | "command") => {
    setBillingBusy(true);
    setBillingMessage(null);
    try {
      const { url } = await createBillingCheckoutSession(targetTier);
      window.location.assign(url);
    } catch (err) {
      setBillingMessage(err instanceof Error ? err.message : "Unable to start checkout.");
      setBillingBusy(false);
    }
  };

  const handleManageBilling = async () => {
    setBillingBusy(true);
    setBillingMessage(null);
    try {
      const { url } = await createBillingPortalSession();
      window.location.assign(url);
    } catch (err) {
      setBillingMessage(err instanceof Error ? err.message : "Unable to open billing portal.");
      setBillingBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-4xl leading-none font-serif tracking-tight text-white">Settings</h1>
        <p className="text-xs font-mono text-muted mt-0.5">
          Tier access and multi-portfolio controls.
        </p>
      </div>

      <div className="bg-panel border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-100">Subscription Tier</h2>
          <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs font-mono text-accent">
            {(tier || "observer").toUpperCase()}
          </span>
        </div>

        <div className="text-xs font-mono text-muted space-y-1">
          <p>`observer`: core portfolio tools, no AI endpoints.</p>
          <p>`analyst`: observer + AI endpoints.</p>
          <p>`command`: analyst + multi-portfolio + weekly PDF export.</p>
        </div>

        <p className="text-xs text-muted">
          Current active portfolio:{" "}
          <span className="font-mono text-neutral">
            {activePortfolio?.name ?? authMe?.active_portfolio_id ?? "Not set"}
          </span>
        </p>
      </div>

      <div className="bg-panel border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-100">Billing</h2>
          <span className="text-[11px] font-mono text-muted uppercase">Stripe</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {tier === "observer" ? (
            <>
              <button
                onClick={() => void handleUpgrade("analyst")}
                disabled={billingBusy}
                className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-mono text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                Upgrade to Analyst ($19/mo)
              </button>
              <button
                onClick={() => void handleUpgrade("command")}
                disabled={billingBusy}
                className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-mono text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                Upgrade to Command ($49/mo)
              </button>
            </>
          ) : null}

          {tier === "analyst" ? (
            <button
              onClick={() => void handleUpgrade("command")}
              disabled={billingBusy}
              className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-mono text-accent transition hover:bg-accent/20 disabled:opacity-50"
            >
              Upgrade to Command ($49/mo)
            </button>
          ) : null}

          <button
            onClick={() => void handleManageBilling()}
            disabled={billingBusy}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-neutral transition hover:border-accent/40 hover:text-white disabled:opacity-50"
          >
            Manage Billing
          </button>
        </div>

        {billingMessage ? (
          <p className="text-xs font-mono text-muted">{billingMessage}</p>
        ) : null}
      </div>

      <div className="bg-panel border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-100">Command Features</h2>
          <button
            onClick={() => void handleDownloadWeeklyPdf()}
            disabled={!isCommand || downloadingReport}
            className="text-xs font-mono bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {downloadingReport ? "Generating PDF..." : "Download Weekly PDF"}
          </button>
        </div>

        {!isCommand ? (
          <div className="rounded-lg border border-border bg-[#101013] px-3 py-2">
            <p className="text-xs font-mono text-muted">
              Command tier required for multi-portfolio and PDF export.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={newPortfolioName}
                onChange={(e) => setNewPortfolioName(e.target.value)}
                placeholder="New portfolio name"
                maxLength={120}
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-white outline-none focus:border-accent"
              />
              <button
                onClick={() => void handleCreatePortfolio()}
                disabled={portfolioActionBusy || !newPortfolioName.trim()}
                className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-mono text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                Create
              </button>
            </div>

            {portfoliosLoading ? (
              <p className="text-xs font-mono text-muted">Loading portfolios...</p>
            ) : (
              <div className="space-y-2">
                {portfolios.map((portfolio) => (
                  <div
                    key={portfolio.id}
                    className="rounded-lg border border-border bg-[#101013] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm text-white">{portfolio.name}</p>
                        <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-muted">
                          {portfolio.is_default ? (
                            <span className="rounded border border-border px-1.5 py-0.5">DEFAULT</span>
                          ) : null}
                          {portfolio.is_active ? (
                            <span className="rounded border border-positive/40 bg-positive/10 px-1.5 py-0.5 text-positive">
                              ACTIVE
                            </span>
                          ) : null}
                          <span>Created {fmtDate(portfolio.created_at)}</span>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {!portfolio.is_active ? (
                          <button
                            onClick={() =>
                              void handleActivatePortfolio(portfolio.id, portfolio.name)
                            }
                            disabled={portfolioActionBusy}
                            className="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-mono text-accent transition hover:bg-accent/20 disabled:opacity-50"
                          >
                            Activate
                          </button>
                        ) : null}
                        {!portfolio.is_default ? (
                          <button
                            onClick={() =>
                              void handleDeletePortfolio(portfolio.id, portfolio.name)
                            }
                            disabled={portfolioActionBusy}
                            className="rounded-md border border-negative/30 bg-negative/10 px-2.5 py-1 text-[11px] font-mono text-negative transition hover:bg-negative/20 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {portfolioMessage ? (
          <p className="text-xs font-mono text-muted">{portfolioMessage}</p>
        ) : null}
      </div>

    </div>
  );
}
