import Link from "next/link";

export default function BillingCancelledPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Upgrade cancelled</h1>
      <p className="text-foreground/70">No changes were made to your plan.</p>
      <Link href="/billing" className="text-sm underline">
        Back to billing
      </Link>
    </div>
  );
}
