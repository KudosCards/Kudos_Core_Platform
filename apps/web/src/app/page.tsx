import Link from "next/link";

const steps = [
  {
    title: "Add your recipients",
    body: "Import contacts in minutes — students, customers, staff, or members.",
  },
  {
    title: "Occasions tracked automatically",
    body: "Birthdays, achievements, leavers, seasonal moments — we watch the calendar for you.",
  },
  {
    title: "We design, print and post",
    body: "Personalised, real physical cards land on doorsteps — no admin, no forgotten moments.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-4 dark:border-white/10">
        <span className="text-lg font-semibold">Kudos Cards</span>
        <nav className="flex items-center gap-6 text-sm font-medium">
          <Link href="/login">Log in</Link>
          <Link
            href="/register"
            className="rounded-full bg-foreground px-4 py-2 text-background transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main className="mx-auto flex max-w-3xl flex-1 flex-col items-start justify-center gap-6 px-6 py-24">
        <p className="text-sm font-medium tracking-wide text-foreground/60 uppercase">
          Recognition that builds retention
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Never miss a moment that matters.
        </h1>
        <p className="max-w-xl text-lg text-foreground/70">
          Kudos Cards automates personalised, physical recognition — birthdays, achievements,
          leavers, and more — so your organisation builds real loyalty without the admin.
        </p>
        <Link
          href="/register"
          className="rounded-full bg-foreground px-6 py-3 text-background transition-opacity hover:opacity-90"
        >
          Start free
        </Link>

        <ol className="mt-12 grid gap-8 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-foreground/50">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h2 className="font-semibold">{step.title}</h2>
              <p className="text-sm text-foreground/70">{step.body}</p>
            </li>
          ))}
        </ol>
      </main>

      <footer className="border-t border-black/10 px-6 py-6 text-sm text-foreground/60 dark:border-white/10">
        © {new Date().getFullYear()} Kudos Cards Ltd.
      </footer>
    </div>
  );
}
