import Link from "next/link";

export default function BatchOrderSuccessPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Payment received</h1>
      <p className="text-foreground/70">
        Thanks — your cards are on their way to production. You&apos;ll see them move through
        printing and posting from the batch order&apos;s status.
      </p>
      <div className="flex gap-3">
        <Link href="/batch-orders" className="text-sm underline">
          Back to checkout
        </Link>
        <Link href="/dashboard" className="text-sm underline">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
