import Link from "next/link";

export default function BatchOrderSuccessPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div className="card flex flex-col gap-4 p-8">
        <span className="text-4xl">🎉</span>
        <h1 className="text-2xl font-bold tracking-tight">Your card is on its way</h1>
        <p className="text-muted">
          Payment received — we&apos;re printing and posting it now. You can follow it through
          printing and posting from your orders at any time.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/orders" className="btn-accent">
            View orders
          </Link>
          <Link href="/dashboard" className="btn-secondary">
            Go to dashboard
          </Link>
        </div>
      </div>

      {/* Turn a first send into the habit: get the whole list in so birthdays
          land on the calendar automatically. */}
      <div className="card flex flex-col gap-3 p-6">
        <h2 className="font-semibold">Do this once, never miss a birthday again</h2>
        <p className="text-sm text-muted">
          Import your students or team and every birthday lands on your calendar automatically — so
          the next card practically sends itself.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/recipients" className="btn-accent">
            Import your list
          </Link>
          <Link href="/calendar" className="btn-secondary">
            See the calendar
          </Link>
        </div>
      </div>
    </div>
  );
}
