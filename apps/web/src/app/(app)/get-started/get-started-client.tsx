"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { planDisplayName } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { clearPendingPlan, readPendingPlan, type PaidPlan } from "@/lib/pending-plan";
import { ConnectCrmCallout } from "@/components/connect-crm-callout";
import { AddressFields } from "@/components/address-fields";
import { CsvImport } from "@/components/csv-import";

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
            done ? "bg-success text-white" : "bg-accent text-white"
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

export function GetStartedClient({
  initialRecipientCount,
  accountType = "organisation",
}: {
  initialRecipientCount: number;
  accountType?: "individual" | "organisation";
}) {
  // A personal (individual) account is a consumer tracking their own friends'
  // and family's birthdays — lead with adding one person by hand, not a bulk
  // spreadsheet import. See docs/adr/0025.
  const personal = accountType === "individual";
  const [recipientCount, setRecipientCount] = useState(initialRecipientCount);
  const plan = usePendingPlan();
  const [error, setError] = useState<string | null>(null);
  const [addingManual, setAddingManual] = useState(false);
  const [activating, setActivating] = useState(false);
  // Bumped after a successful manual add to remount AddressFields (it's
  // controlled internally, so a form reset alone won't clear it).
  const [addFormKey, setAddFormKey] = useState(0);

  const hasContacts = recipientCount > 0;

  async function refreshCount() {
    try {
      const result = await clientApiFetch<{ total: number }>("/recipients?perPage=1");
      setRecipientCount(result.total);
    } catch {
      // Non-fatal — the step just won't tick over until the next load.
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
    const addressLine1 = String(data.get("addressLine1") || "").trim();
    const addressLine2 = String(data.get("addressLine2") || "").trim();
    const addressCity = String(data.get("addressCity") || "").trim();
    const addressPostcode = String(data.get("addressPostcode") || "").trim();
    if (!firstName || !lastName) {
      setError("A first and last name are needed.");
      return;
    }
    // The address is optional here — add the contact now, complete it later. A
    // card can't be sent until it's there, but that's enforced at send time.
    setAddingManual(true);
    try {
      await clientApiFetch("/recipients", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          ...(dateOfBirth && { dateOfBirth }),
          ...(addressLine1 && { addressLine1 }),
          ...(addressLine2 && { addressLine2 }),
          ...(addressCity && { addressCity }),
          ...(addressPostcode && { addressPostcode }),
        }),
      });
      formEl.reset();
      setAddFormKey((k) => k + 1);
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
        <h1 className="text-3xl font-bold tracking-tight">
          {personal ? "Let's add your first birthday" : "Let's get you set up"}
        </h1>
        <p className="text-muted">
          {personal
            ? "Add the people you care about and we'll remind you before every birthday — and can even send the card for you."
            : "Kudos is at its best in bulk — get your list in once and every birthday is handled for you from then on."}
        </p>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

      {plan && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft/40 p-4">
          <div>
            <p className="font-semibold">Activate your {planDisplayName(plan)} plan</p>
            <p className="text-sm text-muted">
              Unlock more contacts, auto-send and a discount on every card. You can do this any
              time.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void activatePlan()}
            disabled={activating}
            className="btn-accent"
          >
            {activating ? "Redirecting…" : `Activate ${planDisplayName(plan)}`}
          </button>
        </div>
      )}

      {/* Step 1 — the priority: get the first person(s) in. */}
      <Step
        n={1}
        done={hasContacts}
        title={personal ? "Add your first birthday" : "Upload your contact list"}
      >
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
        ) : personal ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Add someone whose birthday you never want to miss — just their name and the date.
            </p>
            <form onSubmit={(event) => void handleAddManual(event)} className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <input
                  name="firstName"
                  placeholder="First name"
                  className={`${inputClass} flex-1`}
                />
                <input name="lastName" placeholder="Last name" className={`${inputClass} flex-1`} />
                <input
                  type="date"
                  name="dateOfBirth"
                  aria-label="Date of birth"
                  className={inputClass}
                />
              </div>
              <AddressFields key={addFormKey} required={false} />
              <button type="submit" disabled={addingManual} className="btn-accent w-fit">
                {addingManual ? "Adding…" : "Add birthday"}
              </button>
            </form>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">
                Got a lot of people? Import a spreadsheet
              </summary>
              <div className="mt-3">
                <CsvImport onImported={() => void refreshCount()} />
              </div>
            </details>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Import your students or team from a spreadsheet — name, date of birth, and address if
              you have it. Birthdays appear on your calendar automatically.
            </p>
            <CsvImport onImported={() => void refreshCount()} />

            <details className="text-sm">
              <summary className="cursor-pointer text-muted">Or add one by hand</summary>
              <form
                onSubmit={(event) => void handleAddManual(event)}
                className="mt-3 flex flex-col gap-2"
              >
                <div className="flex flex-wrap gap-2">
                  <input
                    name="firstName"
                    placeholder="First name"
                    className={`${inputClass} flex-1`}
                  />
                  <input
                    name="lastName"
                    placeholder="Last name"
                    className={`${inputClass} flex-1`}
                  />
                  <input type="date" name="dateOfBirth" className={inputClass} />
                </div>
                <AddressFields key={addFormKey} required={false} />
                <button type="submit" disabled={addingManual} className="btn-secondary w-fit">
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
