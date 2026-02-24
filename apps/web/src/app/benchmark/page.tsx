"use client";

export default function BenchmarkPage() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-4xl leading-none font-serif tracking-tight text-white">Benchmark</h1>
        <p className="text-xs font-mono text-muted mt-0.5">
          Configure the benchmark used for alpha and beta calculations.
        </p>
      </div>

      <div className="bg-panel border border-border rounded-xl p-5 space-y-4">
        <div>
          <label className="text-xs font-mono text-muted uppercase tracking-wider block mb-2">
            Current Benchmark
          </label>
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-semibold text-accent">SPY</span>
            <span className="text-xs font-mono text-muted">SPDR S&amp;P 500 ETF Trust</span>
          </div>
        </div>

        <div>
          <label className="text-xs font-mono text-muted uppercase tracking-wider block mb-2">
            Change Benchmark
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              defaultValue="SPY"
              className="bg-surface border border-border rounded px-3 py-1.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-accent w-28"
              disabled
            />
            <button
              disabled
              className="text-xs font-mono bg-border/50 text-muted rounded px-3 py-1.5 cursor-not-allowed"
            >
              Update (Phase 2)
            </button>
          </div>
          <p className="text-xs text-muted mt-2 font-mono">
            Multi-benchmark support coming in Phase 2. SPY is hardcoded for MVP.
          </p>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-xs font-mono text-muted uppercase tracking-wider mb-2">
            What SPY column must look like in your Excel
          </p>
          <div className="bg-surface border border-border rounded p-3 font-mono text-xs text-gray-300 space-y-1">
            <p>Column header: <span className="text-accent">SPY Period Return</span></p>
            <p>Format: <span className="text-accent">3.65%</span> or <span className="text-accent">0.0365</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}
