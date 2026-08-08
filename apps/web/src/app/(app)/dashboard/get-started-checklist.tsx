"use client";

import { Target } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";

interface ChecklistStep {
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
}

// Personal per-browser preference (an account is shared by teammates, so this
// stays local rather than on the account). Bump the suffix if the steps ever
// change enough that a past dismissal shouldn't carry over.
const STORAGE_KEY = "kudos.setupChecklist.v1";
// Fired on our own writes so same-tab instances re-read (the native "storage"
// event only fires in *other* tabs).
const CHANGE_EVENT = "kudos:setup-checklist-change";

type ChecklistView = "expanded" | "collapsed" | "dismissed";

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

// Client snapshot: the stored view, defaulting to expanded.
function getSnapshot(): ChecklistView {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "collapsed" || stored === "dismissed" ? stored : "expanded";
}

// Server (and first hydration) snapshot: `null` renders nothing, so a dismissed
// guide never flashes in before the stored preference is read on the client.
function getServerSnapshot(): ChecklistView | null {
  return null;
}

function persistView(next: ChecklistView) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private-mode/quota failures are non-fatal — the choice just won't stick.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * The dashboard onboarding widget. Mirrors the three steps of /get-started but
 * with live completion state. It stays on the home screen until the account has
 * imported contacts, has birthdays lined up, and placed its first paid order —
 * at which point it renders nothing and the dashboard returns to its normal
 * "what needs my attention" shape.
 *
 * Returning users who don't want the nudge can **minimise** it (collapse to a
 * slim header) or **dismiss** it entirely; either choice persists per browser.
 * A dismissed guide leaves behind a thin "Show setup guide" bar so it can be
 * reopened later. See docs/adr/0022 and 0054.
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
  // `null` until the client reads the stored preference (see getServerSnapshot).
  const view = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

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
  // Nothing left to nudge — let the dashboard breathe (regardless of preference).
  if (completed === steps.length) return null;

  // Pre-hydration: render nothing.
  if (view === null) return null;

  const progressBadge = (
    <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
      {completed} of {steps.length} done
    </span>
  );

  // Dismissed: leave a slim, unobtrusive way back in.
  if (view === "dismissed") {
    return (
      <button
        type="button"
        onClick={() => persistView("expanded")}
        className="card flex items-center justify-between gap-3 p-3 text-left text-sm text-muted transition-colors hover:border-foreground/20 hover:text-foreground"
      >
        <span>
          <Target className="mr-2 inline h-4 w-4 align-text-bottom" aria-hidden />
          Show setup guide
        </span>
        {progressBadge}
      </button>
    );
  }

  const isCollapsed = view === "collapsed";

  return (
    <section className="card flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => persistView(isCollapsed ? "expanded" : "collapsed")}
          aria-expanded={!isCollapsed}
          className="group flex flex-1 items-center gap-2 text-left"
        >
          <ChevronIcon
            className={`size-4 shrink-0 text-muted transition-transform ${
              isCollapsed ? "-rotate-90" : ""
            }`}
          />
          <span>
            <span className="font-semibold group-hover:underline">Let&apos;s get you set up</span>
            {!isCollapsed && (
              <span className="block text-sm text-muted">
                Three steps to your first automated birthday card.
              </span>
            )}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {progressBadge}
          <button
            type="button"
            onClick={() => persistView(isCollapsed ? "expanded" : "collapsed")}
            className="rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-foreground/[0.04] hover:text-foreground"
          >
            {isCollapsed ? "Expand" : "Minimise"}
          </button>
          <button
            type="button"
            onClick={() => persistView("dismissed")}
            className="rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-foreground/[0.04] hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      </div>

      {!isCollapsed && (
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
      )}
    </section>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
