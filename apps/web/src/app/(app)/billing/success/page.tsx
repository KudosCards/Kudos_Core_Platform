import Link from "next/link";

export default function BillingSuccessPage() {
  return (
    <div className="card mx-auto flex max-w-lg flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold tracking-tight">You&apos;re all set</h1>
      <p className="text-muted">
        Your subscription is being set up — it may take a moment to appear here once Stripe confirms
        the payment.
      </p>
      <Link href="/billing" className="btn-accent self-start">
        Back to billing
      </Link>
    </div>
  );
}
