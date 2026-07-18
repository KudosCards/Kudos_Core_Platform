import Link from "next/link";

export default function BatchOrderSuccessPage() {
  return (
    <div className="card mx-auto flex max-w-lg flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold tracking-tight">Payment received</h1>
      <p className="text-muted">
        Thanks — your cards are on their way to production. You&apos;ll see them move through
        printing and posting from the batch order&apos;s status.
      </p>
      <div className="flex gap-3">
        <Link href="/orders" className="btn-accent">
          View orders
        </Link>
        <Link href="/dashboard" className="btn-secondary">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
