import Link from "next/link";

export default function BillingSuccessPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">You&apos;re all set</h1>
      <p className="text-foreground/70">
        Your subscription is being set up — it may take a moment to appear here once Stripe confirms
        the payment.
      </p>
      <Link href="/billing" className="text-sm underline">
        Back to billing
      </Link>
    </div>
  );
}
