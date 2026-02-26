"use client";

import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Privacy Policy
        </h1>
        <p className="mt-1 text-sm text-muted">Last updated: February 2026</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">1. Data We Collect</h2>
        <p className="text-sm leading-6 text-gray-400">
          Alphenzi stores the following information locally in its database:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm text-gray-400 pl-2">
          <li>Portfolio holdings you manually enter (ticker, shares, cost basis)</li>
          <li>Weekly portfolio value data imported from Excel</li>
          <li>Your risk playbook thresholds and settings</li>
          <li>News events fetched from public sources (cached locally)</li>
          <li>AI conversation history (stored in your browser session only, not persisted)</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">2. Data We Do NOT Collect</h2>
        <ul className="list-disc list-inside space-y-1 text-sm text-gray-400 pl-2">
          <li>We do not collect your name, email, or personal identity information</li>
          <li>We do not track usage analytics or telemetry</li>
          <li>We do not sell any data to third parties</li>
          <li>We do not store passwords (no authentication layer in current version)</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">3. External Services</h2>
        <p className="text-sm leading-6 text-gray-400">
          This platform communicates with the following external services:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm text-gray-400 pl-2">
          <li>
            <strong className="text-gray-300">Yahoo Finance</strong> — for market prices, ticker validation,
            and fundamentals. Your ticker symbols are sent to Yahoo&apos;s public API.
          </li>
          <li>
            <strong className="text-gray-300">OpenAI / Google Gemini</strong> — if AI is enabled,
            anonymised portfolio context (holdings, metrics, news headlines) is sent to the AI provider.
            No personally identifying information is included.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">4. Data Storage</h2>
        <p className="text-sm leading-6 text-gray-400">
          All portfolio data is stored in a locally-hosted PostgreSQL database. In self-hosted deployments,
          you control where this database runs. No data is sent to Alphenzi servers.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">5. Session Storage</h2>
        <p className="text-sm leading-6 text-gray-400">
          The browser session storage is used to cache AI summaries and pipeline state for the duration
          of your browser session. This data is cleared when you close the tab.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">6. Contact</h2>
        <p className="text-sm leading-6 text-gray-400">
          For privacy questions, contact the platform administrator directly.
        </p>
      </section>

      <div className="border-t border-border pt-4 flex gap-4 text-xs text-muted">
        <Link href="/" className="hover:text-white transition">← Back to Dashboard</Link>
        <Link href="/disclaimer" className="hover:text-white transition">Disclaimer</Link>
      </div>
    </div>
  );
}
