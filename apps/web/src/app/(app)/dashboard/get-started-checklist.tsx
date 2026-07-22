import Link from "next/link";

interface ChecklistStep {
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
}

/**
 * The dashboard onboarding widget. Mirrors the three steps of /get-started but
 * with live completion state, and stays on the home screen until the account has
 * imported contacts, has birthdays lined up, and placed its first paid order.
 * Once all three are done it renders nothing, so the dashboard returns to its
 * normal "what needs my attention" shape.
 */
export function GetStartedChecklist({
  recipientCount,
  hasOccasions,
  firstOrderPlaced,
}: {
  recipientCount: number;
  hasOccasions: boolean;
  firstOrderPlaced: boolean;
}) {
  const steps: ChecklistStep[] = [
    {
      title: "Add your contacts",
      description:
        recipientCount > 0
          ? `${recipientCount.toLocaleString("en-GB")} contact${recipientCount === 1 ? "" : "s"} on file.`
          : "Import your students or team — every birthday lands on your calendar automatically.",
      done: recipientCount > 0,
      href: recipientCount > 0 ? "/recipients" : "/get-started",
      cta: recipientCount > 0 ? "Manage contacts" : "Import contacts",
    },
    {
      title: "Line up their birthdays",
      description: hasOccasions
        ? "Birthdays are on your calendar, ready to approve or auto-send."
        : "Add contacts with a date of birth and their occasions appear here.",
      done: hasOccasions,
      href: "/calendar",
      cta: "Open the calendar",
    },
    {
      title: "Send your first card",
      description: firstOrderPlaced
        ? "Your first card is on its way."
        : "Pick a design, personalise it, and we print and post a real card to their door.",
      done: firstOrderPlaced,
      href: "/cards",
      cta: "Browse designs",
    },
  ];

  const completed = steps.filter((step) => step.done).length;
  // Nothing left to nudge — let the dashboard breathe.
  if (completed === steps.length) return null;

  return (
    <section className="card flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">Let&apos;s get you set up</p>
          <p className="text-sm text-muted">
            Three steps to your first automated birthday card.
          </p>
        </div>
        <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
          {completed} of {steps.length} done
        </span>
      </div>

      <ol className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  step.done ? "bg-emerald-500 text-white" : "bg-accent text-white"
                }`}
              >
                {step.done ? "✓" : index + 1}
              </span>
              <div>
                <p className={`font-medium ${step.done ? "text-muted line-through" : ""}`}>
                  {step.title}
                </p>
                <p className="text-sm text-muted">{step.description}</p>
              </div>
            </div>
            {!step.done && (
              <Link href={step.href} className="btn-accent shrink-0 text-sm sm:ml-3">
                {step.cta} <span aria-hidden>→</span>
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
