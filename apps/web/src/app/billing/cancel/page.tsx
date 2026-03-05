import Link from "next/link";

export default function BillingCancelPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-4xl leading-none font-serif tracking-tight text-white">Checkout Canceled</h1>
        <p className="text-xs font-mono text-muted mt-0.5">
          No changes were made to your current plan.
        </p>
      </div>

      <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
        <p className="text-sm text-gray-100">You can return to billing anytime to upgrade.</p>
        <div className="pt-1">
          <Link
            href="/billing"
            className="inline-flex rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-mono text-accent transition hover:bg-accent/20"
          >
            Back to Billing
          </Link>
        </div>
      </div>
    </div>
  );
}
