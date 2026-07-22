"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { clearPendingPlan, readPendingPlan, type PaidPlan } from "@/lib/pending-plan";
import { ConnectCrmCallout } from "@/components/connect-crm-callout";

/** Read the pending plan from localStorage on the client only (null during SSR),
 * without a setState-in-effect. localStorage doesn't change under us here, so an
 * empty subscribe is fine. */
function usePendingPlan(): PaidPlan | null {
  return useSyncExternalStore(
    () => () => {},
    () => readPendingPlan(),
    () => null,
  );
}

interface ImportSummary {
  created: number;
  updated: number;
  rejected: { row: number; reason: string }[];
}

const PLAN_LABEL: Record<PaidPlan, string> = { pro: "Pro", centre: "Centre" };

const SAMPLE_CSV = [
  "firstName,lastName,dateOfBirth,postcode,email",
  "Ava,Thompson,14/03/2015,SW1A 1AA,ava@example.com",
  "Noah,Patel,02/09/2014,M1 2AB,noah@example.com",
].join("\n");

function downloadSampleCsv() {
  const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "kudos-contacts-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

/** A numbered step shell — coral when active/done, muted when still to-do. */
function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            done ? "bg-emerald-500 text-white" : "bg-accent text-white"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="sm:pl-11">{children}</div>
    </section>
  );
}

export function GetStartedClient({ initialRecipientCount }: { initialRecipientCount: number }) {
  const [recipientCount, setRecipientCount] = useState(initialRecipientCount);
  const plan = usePendingPlan();
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [addingManual, setAddingManual] = useState(false);
  const [activating, setActivating] = useState(false);

  const hasContacts = recipientCount > 0;

  async function refreshCount() {
    try {
      const result = await clientApiFetch<{ total: number }>("/recipients?perPage=1");
      setRecipientCount(result.total);
    } catch {
      // Non-fatal — the step just won't tick over until the next load.
    }
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setImportSummary(null);
    const formEl = event.currentTarget;
    const file = new FormData(formEl).get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a CSV file first.");
      return;
    }
    const upload = new FormData();
    upload.set("file", file);
    setImporting(true);
    try {
      const summary = await clientApiFetch<ImportSummary>("/recipients/import", {
        method: "POST",
        body: upload,
      });
      setImportSummary(summary);
      formEl.reset();
      await refreshCount();
    } catch (importError) {
      setError(importError instanceof ApiError ? importError.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function handleAddManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formEl = event.currentTarget;
    const data = new FormData(formEl);
    const firstName = String(data.get("firstName") || "").trim();
    const lastName = String(data.get("lastName") || "").trim();
    const dateOfBirth = String(data.get("dateOfBirth") || "");
    if (!firstName || !lastName) {
      setError("A first and last name are needed.");
      return;
    }
    setAddingManual(true);
    try {
      await clientApiFetch("/recipients", {
        method: "POST",
        body: JSON.stringify({ firstName, lastName, ...(dateOfBirth && { dateOfBirth }) }),
      });
      formEl.reset();
      await refreshCount();
    } catch (addError) {
      setError(addError instanceof ApiError ? addError.message : "Could not add the contact.");
    } finally {
      setAddingManual(false);
    }
  }

  async function activatePlan() {
    if (!plan) return;
    setError(null);
    setActivating(true);
    try {
      const { checkoutUrl } = await clientApiFetch<{ checkoutUrl: string }>(
        "/subscriptions/checkout",
        { method: "POST", body: JSON.stringify({ planId: plan }) },
      );
      clearPendingPlan();
      window.location.assign(checkoutUrl);
    } catch (activateError) {
      setError(
        activateError instanceof ApiError ? activateError.message : "Could not start checkout.",
      );
      setActivating(false);
    }
  }

  const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Let&apos;s get you set up</h1>
        <p className="text-muted">
          Kudos is at its best in bulk — get your list in once and every birthday is handled for you
          from then on.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      {plan && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft/40 p-4">
          <div>
            <p className="font-semibold">Activate your {PLAN_LABEL[plan]} plan</p>
            <p className="text-sm text-muted">
              Unlock more contacts, auto-send and a discount on every card. You can do this any time.
            </p>
          </div>
          <button type="button" onClick={() => void activatePlan()} disabled={activating} className="btn-accent">
            {activating ? "Redirecting…" : `Activate ${PLAN_LABEL[plan]}`}
          </button>
        </div>
      )}

      {/* Step 1 — the priority: get the contact list in. */}
      <Step n={1} done={hasContacts} title="Upload your contact list">
        {hasContacts ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {recipientCount.toLocaleString("en-GB")} contact{recipientCount === 1 ? "" : "s"} on
              file. Every one with a date of birth is already on your calendar.
            </p>
            <Link href="/recipients" className="btn-secondary w-fit text-sm">
              Manage or import more contacts
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Import your students or team from a spreadsheet — name, date of birth, and address if
              you have it. Birthdays appear on your calendar automatically.
            </p>
            <form onSubmit={(event) => void handleImport(event)} className="flex flex-col gap-2">
              <input type="file" name="file" accept=".csv" required className="text-sm" />
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={importing} className="btn-accent">
                  {importing ? "Importing…" : "Import contacts"}
                </button>
                <button
                  type="button"
                  onClick={downloadSampleCsv}
                  className="text-sm text-accent underline hover:no-underline"
                >
                  Download a template
                </button>
              </div>
              <p className="text-xs text-muted">
                Columns: firstName, lastName, dateOfBirth (dd/mm/yyyy), postcode, email
              </p>
            </form>

            {importSummary && (
              <p className="text-sm text-muted">
                Imported {importSummary.created} new contact{importSummary.created === 1 ? "" : "s"}
                {importSummary.rejected.length > 0 && `, ${importSummary.rejected.length} skipped`}.
              </p>
            )}

            <details className="text-sm">
              <summary className="cursor-pointer text-muted">Or add one by hand</summary>
              <form
                onSubmit={(event) => void handleAddManual(event)}
                className="mt-3 flex flex-wrap items-end gap-2"
              >
                <input name="firstName" placeholder="First name" className={inputClass} />
                <input name="lastName" placeholder="Last name" className={inputClass} />
                <input type="date" name="dateOfBirth" className={inputClass} />
                <button type="submit" disabled={addingManual} className="btn-secondary">
                  {addingManual ? "Adding…" : "Add"}
                </button>
              </form>
            </details>

            <ConnectCrmCallout compact />
          </div>
        )}
      </Step>

      {/* Step 2 — the payoff. */}
      <Step n={2} done={false} title="See your birthday calendar">
        <p className="mb-3 text-sm text-muted">
          {hasContacts
            ? "Your contacts' birthdays are lined up and ready to approve or auto-send."
            : "As soon as your contacts are in, their birthdays fill your calendar here."}
        </p>
        <Link href="/calendar" className={hasContacts ? "btn-accent" : "btn-secondary"}>
          Open the calendar
        </Link>
      </Step>

      {/* Step 3 — the first send. */}
      <Step n={3} done={false} title="Design &amp; send a card">
        <p className="mb-3 text-sm text-muted">
          Pick a design, personalise it, and we&apos;ll print and post a real card to their door.
        </p>
        <Link href="/cards" className="btn-secondary">
          Browse card designs
        </Link>
      </Step>

      <p className="text-center text-sm text-muted">
        You can leave setup any time —{" "}
        <Link href="/dashboard" className="text-accent hover:underline">
          skip to the dashboard
        </Link>
        .
      </p>
    </div>
  );
}
