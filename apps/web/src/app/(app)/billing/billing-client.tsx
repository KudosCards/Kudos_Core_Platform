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
      if (upgradeError instanceof ApiError && upgradeError.status === 409) {
        setError("This plan isn't available for online upgrade yet — please contact us.");
      } else {
        setError(
          upgradeError instanceof ApiError ? upgradeError.message : "Could not start checkout",
        );
      }
      setPendingPlan(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-foreground/60">Manage your plan.</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = plan.planId === currentPlanId;
          return (
            <div
              key={plan.planId}
              className="flex flex-col gap-3 rounded-lg border border-black/10 p-5 dark:border-white/10"
            >
              <div>
                <p className="font-medium">{plan.name}</p>
                <p className="text-2xl font-semibold">{plan.priceLabel}</p>
              </div>
              <p className="flex-1 text-sm text-foreground/60">{plan.description}</p>
              {isCurrent ? (
                <span className="rounded-full bg-black/5 px-4 py-1.5 text-center text-sm font-medium dark:bg-white/10">
                  Current plan
                </span>
              ) : plan.planId === "free" ? (
                <span className="text-center text-sm text-foreground/40">—</span>
              ) : (
                <button
                  type="button"
                  disabled={pendingPlan === plan.planId}
                  onClick={() => void upgrade(plan.planId as "pro" | "centre")}
                  className="rounded-full bg-foreground px-4 py-1.5 text-sm text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
