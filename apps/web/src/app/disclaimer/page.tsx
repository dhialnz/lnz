"use client";

import Link from "next/link";

export default function DisclaimerPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Disclaimer &amp; Terms of Use
        </h1>
        <p className="mt-1 text-sm text-muted">Last updated: February 2026</p>
      </div>

      <section className="rounded-xl border border-amber-500/30 bg-amber-900/10 p-5">
        <p className="text-sm font-semibold text-amber-400">
          NOT FINANCIAL ADVICE
        </p>
        <p className="mt-2 text-sm leading-6 text-gray-300">
          Alphenzi is a <strong className="text-white">personal analytics tool</strong>.
          All outputs — including metrics, AI-generated recommendations, news impact scores, and
          risk indicators — are for <strong className="text-white">informational and educational purposes only</strong>.
          Nothing on this platform constitutes financial advice, investment advice, trading advice,
          or any other type of professional advice.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">1. Accuracy of Information</h2>
        <p className="text-sm leading-6 text-gray-400">
          Market prices, news data, and analytical outputs may be delayed, inaccurate, or incomplete.
          Alphenzi makes no representations or warranties regarding the accuracy, completeness, or timeliness
          of any information displayed. Always verify data independently before making any financial decision.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">2. AI-Generated Content</h2>
        <p className="text-sm leading-6 text-gray-400">
          This platform uses AI language models to generate portfolio summaries, recommendations, and
          commentary. AI outputs may contain errors, hallucinations, or outdated information.
          AI-generated buy/sell/hold suggestions are <strong className="text-white">not investment recommendations</strong>.
          All AI tickers shown have undergone basic validation against Yahoo Finance, but this does not
          constitute endorsement or suitability analysis.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">3. No Liability</h2>
        <p className="text-sm leading-6 text-gray-400">
          The creators of Alphenzi shall not be liable for any losses, damages, or decisions made based on
          information or outputs from this platform. Use of this tool is entirely at your own risk.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">4. Data Sources</h2>
        <p className="text-sm leading-6 text-gray-400">
          Market data is sourced from Yahoo Finance and other free public APIs. News data is sourced
          from publicly available RSS feeds and news aggregators. These sources are not affiliated with Alphenzi.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">5. Personal Use Only</h2>
        <p className="text-sm leading-6 text-gray-400">
          This platform is designed for personal portfolio tracking. It is not registered as a
          financial advisor, broker-dealer, investment advisor, or any regulated financial entity.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">6. Changes to Terms</h2>
        <p className="text-sm leading-6 text-gray-400">
          These terms may be updated at any time without notice. Continued use of the platform
          constitutes acceptance of the current terms.
        </p>
      </section>

      <div className="border-t border-border pt-4 flex gap-4 text-xs text-muted">
        <Link href="/" className="hover:text-white transition">← Back to Dashboard</Link>
        <Link href="/privacy" className="hover:text-white transition">Privacy Policy</Link>
      </div>
    </div>
  );
}
