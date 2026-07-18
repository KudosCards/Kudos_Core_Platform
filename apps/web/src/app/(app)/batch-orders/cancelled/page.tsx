import Link from "next/link";

export default function BatchOrderCancelledPage() {
  return (
    <div className="card mx-auto flex max-w-lg flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold tracking-tight">Checkout cancelled</h1>
      <p className="text-muted">
        No payment was taken. Your selected occasions are still approved and ready — you can pick up
        checkout again whenever you&apos;re ready.
      </p>
      <div className="flex gap-3">
        <Link href="/batch-orders" className="btn-accent">
          Back to checkout
        </Link>
      </div>
    </div>
  );
}
