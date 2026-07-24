"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

interface PlanOption {
  planId: "free" | "pro" | "centre";
  name: string;
  priceLabel: string;
  description: string;
}

/** Real, confirmed pricing — see docs/adr/0008-checkout-pricing.md. */
const PLANS: PlanOption[] = [
  { planId: "free", name: "Starter", priceLabel: "£0/mo", description: "Get started for free." },
  {
    planId: "pro",
    name: "Pro",
    priceLabel: "£9.97/mo",
    description: "More recipients, auto-send, a discount per card.",
  },
  {
    planId: "centre",
    name: "Centre",
    priceLabel: "£19.97/mo",
    description: "Unlimited recipients and the best per-card rate.",
  },
];

export function BillingClient({
  currentPlanId,
  remindersEnabled,
}: {
  currentPlanId: string | null;
  remindersEnabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [reminders, setReminders] = useState(remindersEnabled);
  const [savingReminders, setSavingReminders] = useState(false);

  async function toggleReminders() {
    const next = !reminders;
    setReminders(next);
    setSavingReminders(true);
    setError(null);
    try {
      await clientApiFetch("/accounts/me/notifications", {
        method: "PATCH",
        body: JSON.stringify({ reminderEmailsEnabled: next }),
      });
    } catch (toggleError) {
      setReminders(!next); // revert on failure
      setError(
        toggleError instanceof ApiError ? toggleError.message : "Could not update reminders",
      );
    } finally {
      setSavingReminders(false);
    }
  }

  async function openBillingPortal() {
    setError(null);
    setOpeningPortal(true);
    try {
      const { url } = await clientApiFetch<{ url: string }>("/subscriptions/portal", {
        method: "POST",
      });
      window.location.assign(url);
    } catch (portalError) {
      setError(
        portalError instanceof ApiError ? portalError.message : "Could not open billing portal",
      );
      setOpeningPortal(false);
    }
  }

  async function upgrade(planId: "pro" | "centre") {
    setError(null);
    setPendingPlan(planId);
    try {
      const { checkoutUrl } = await clientApiFetch<{ checkoutUrl: string }>(
        "/subscriptions/checkout",
        {
          method: "POST",
          body: JSON.stringify({ planId }),
        },
      );
      window.location.assign(checkoutUrl);
    } catch (upgradeError) {
      // The API's error message is already specific (e.g. "not yet
      // configured for checkout" vs "already has an active subscription").
      setError(
        upgradeError instanceof ApiError ? upgradeError.message : "Could not start checkout",
      );
      setPendingPlan(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted">Manage your plan.</p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
        <div>
          <p className="font-semibold">New here? Start with your contacts</p>
          <p className="text-sm text-muted">
            Import your list once and every birthday is handled for you from then on.
          </p>
        </div>
        <Link href="/get-started" className="btn-accent">
          Set up your account
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = plan.planId === currentPlanId;
          return (
            <div
              key={plan.planId}
              className={`flex flex-col gap-3 rounded-xl border p-5 ${
                isCurrent ? "border-accent bg-accent-soft/40" : "border-border bg-surface"
              }`}
            >
              <div>
                <p className="font-semibold">{plan.name}</p>
                <p className="text-2xl font-bold tracking-tight">{plan.priceLabel}</p>
              </div>
              <p className="flex-1 text-sm text-muted">{plan.description}</p>
              {isCurrent ? (
                <span className="rounded-lg bg-surface px-4 py-1.5 text-center text-sm font-semibold text-accent">
                  Current plan
                </span>
              ) : plan.planId === "free" ? (
                <span className="text-center text-sm text-muted">—</span>
              ) : (
                <button
                  type="button"
                  disabled={pendingPlan === plan.planId}
                  onClick={() => void upgrade(plan.planId as "pro" | "centre")}
                  className="btn-accent"
                >
                  {pendingPlan === plan.planId ? "Redirecting…" : `Switch to ${plan.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
        <div>
          <p className="font-semibold">Invoices &amp; receipts</p>
          <p className="text-sm text-muted">
            Download your invoices and receipts, update your payment card, or cancel — all in Stripe&apos;s
            secure billing portal.
          </p>
        </div>
        <button
          type="button"
          disabled={openingPortal}
          onClick={() => void openBillingPortal()}
          className="btn-secondary"
        >
          {openingPortal ? "Opening…" : "Manage billing"}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
        <div>
          <p className="font-semibold">Birthday reminder emails</p>
          <p className="text-sm text-muted">
            We&apos;ll email you a week before each upcoming birthday so nothing slips by.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={reminders}
          disabled={savingReminders}
          onClick={() => void toggleReminders()}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            reminders ? "bg-accent" : "bg-foreground/20"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              reminders ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
