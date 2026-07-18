import Link from "next/link";

export default function BillingCancelledPage() {
  return (
    <div className="card mx-auto flex max-w-lg flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold tracking-tight">Upgrade cancelled</h1>
      <p className="text-muted">No changes were made to your plan.</p>
      <Link href="/billing" className="btn-accent self-start">
        Back to billing
      </Link>
    </div>
  );
}
