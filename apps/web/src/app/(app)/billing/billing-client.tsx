"use client";

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

export function BillingClient({ currentPlanId }: { currentPlanId: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);

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
    </div>
  );
}
