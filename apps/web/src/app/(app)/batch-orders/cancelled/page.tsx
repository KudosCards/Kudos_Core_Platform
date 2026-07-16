import Link from "next/link";

export default function BatchOrderCancelledPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Checkout cancelled</h1>
      <p className="text-foreground/70">
        No payment was taken. Your selected occasions are still approved and ready — you can pick up
        checkout again whenever you&apos;re ready.
      </p>
      <div className="flex gap-3">
        <Link href="/batch-orders" className="text-sm underline">
          Back to checkout
        </Link>
      </div>
    </div>
  );
}
