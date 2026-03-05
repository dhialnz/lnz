import Link from "next/link";

export default function BillingSuccessPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-4xl leading-none font-serif tracking-tight text-white">Thank You</h1>
        <p className="text-xs font-mono text-muted mt-0.5">
          Your plan update was received successfully.
        </p>
      </div>

      <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
        <p className="text-sm text-gray-100">
          Your subscription is now being finalized. You can return to the app.
        </p>
        <p className="text-xs font-mono text-muted">
          If your tier badge does not update immediately, refresh once after a few seconds.
        </p>
        <div className="pt-1">
          <Link
            href="/"
            className="inline-flex rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-mono text-accent transition hover:bg-accent/20"
          >
            Return to App
          </Link>
        </div>
      </div>
    </div>
  );
}
