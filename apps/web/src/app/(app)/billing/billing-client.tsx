"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ENTERPRISE_PLAN,
  PLAN_CATALOG,
  formatPlanPrice,
  planCardPriceLabel,
  type PaidPlanId,
} from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

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

  async function upgrade(planId: PaidPlanId) {
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

      {error && <p className="notice notice-danger">{error}</p>}

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

      <div className="grid items-start gap-4 sm:grid-cols-3">
        {PLAN_CATALOG.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          return (
            <div
              key={plan.id}
              className={`flex flex-col gap-3 rounded-xl border p-5 ${
                isCurrent
                  ? "border-accent bg-accent-soft/40"
                  : plan.highlight
                    ? "border-accent/40 bg-surface"
                    : "border-border bg-surface"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{plan.name}</p>
                  <p className="text-xs text-muted">{plan.tagline}</p>
                </div>
                {plan.highlight && !isCurrent && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                    Most popular
                  </span>
                )}
              </div>
              <p>
                <span className="text-2xl font-bold tracking-tight">
                  {formatPlanPrice(plan.monthlyPriceMinor)}
                </span>
                <span className="text-sm text-muted">/mo</span>
              </p>
              <p className="text-sm font-medium text-success">{planCardPriceLabel(plan)}</p>
              <ul className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
                {plan.inherits && (
                  <li className="font-medium text-foreground/70">{plan.inherits}</li>
                )}
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="mt-0.5 text-success">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <span className="rounded-lg bg-surface px-4 py-1.5 text-center text-sm font-semibold text-accent">
                  Current plan
                </span>
              ) : plan.id === "free" ? (
                <span className="rounded-lg px-4 py-1.5 text-center text-sm text-muted">
                  Downgrade in the billing portal
                </span>
              ) : (
                <button
                  type="button"
                  disabled={pendingPlan === plan.id}
                  onClick={() => void upgrade(plan.id as PaidPlanId)}
                  className="btn-accent"
                >
                  {pendingPlan === plan.id ? "Redirecting…" : `Switch to ${plan.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-foreground/[0.03] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold">{ENTERPRISE_PLAN.name}</p>
            <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted">
              {ENTERPRISE_PLAN.priceLabel} pricing
            </span>
          </div>
          <p className="text-sm text-muted">
            Multiple sites, volume pricing and a dedicated account manager for larger organisations.
          </p>
        </div>
        <Link href={ENTERPRISE_PLAN.ctaHref} className="btn-secondary shrink-0 text-sm">
          {ENTERPRISE_PLAN.ctaLabel}
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
        <div>
          <p className="font-semibold">Invoices &amp; receipts</p>
          <p className="text-sm text-muted">
            Download your invoices and receipts, update your payment card, or cancel — all in
            Stripe&apos;s secure billing portal.
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
