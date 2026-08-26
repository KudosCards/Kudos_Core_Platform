"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ENTERPRISE_PLAN, PLAN_CATALOG, planDisplayName } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

/** The plans an operator can pick. Ordered as the pricing table is, with
 * Enterprise last — it has no self-serve checkout, so setting it by hand here is
 * the only way an account gets onto it. The API validates the choice against
 * PlanEntitlement regardless, so this list can never grant something real. */
const PLAN_IDS: string[] = [...PLAN_CATALOG.map((plan) => plan.id), ENTERPRISE_PLAN.id];

/**
 * Set a customer's plan by hand, with no Stripe subscription behind it.
 *
 * For our own internal and test accounts, and for a comped customer. A plan is
 * normally written only by the Stripe subscription webhook, from what the
 * account is actually paying for — so an account that still has a live
 * subscription is refused, both here and by the API. See ADR 0172.
 *
 * Deliberate in the same way the wallet adjustment is: the plan has to be
 * chosen, the reason typed, and the change read back before the button does
 * anything. This grants paid entitlements with no payment behind them.
 */
export function SetPlan({
  accountId,
  customerName,
  currentPlanId,
  subscriptionStatus,
}: {
  accountId: string;
  customerName: string;
  currentPlanId: string;
  /** The live Stripe subscription's status, or null when there isn't one. */
  subscriptionStatus: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // `canceled` is the one status that has released the account back to us. Any
  // other means Stripe will send events for it again, and each one rewrites the
  // plan — so the override would be undone, silently and possibly weeks later.
  const stripeOwnsThePlan = subscriptionStatus !== null && subscriptionStatus !== "canceled";
  const ready = planId !== "" && planId !== currentPlanId && reason.trim().length >= 4;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await clientApiFetch(`/admin/customers/${accountId}/plan`, {
        method: "POST",
        body: JSON.stringify({ planId, reason: reason.trim() }),
      });
      setDone(`${customerName} is now on the ${planDisplayName(planId)} plan.`);
      setOpen(false);
      setPlanId("");
      setReason("");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Could not set the plan");
    } finally {
      setBusy(false);
    }
  }

  if (stripeOwnsThePlan) {
    return (
      <div className="mt-4 border-t border-border pt-4">
        <p className="text-sm font-medium">Plan</p>
        <p className="mt-1 text-xs text-muted">
          On {planDisplayName(currentPlanId)} via a {subscriptionStatus} Stripe subscription, so the
          plan is Stripe&apos;s to change — anything set here would be overwritten by the next
          subscription event. Change it in Stripe instead.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Plan</p>
          <p className="text-xs text-muted">
            On {planDisplayName(currentPlanId)}, with no Stripe subscription.
          </p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-sm">
            Change plan
          </button>
        )}
      </div>

      {done && <p className="notice notice-success mt-2">{done}</p>}

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">New plan</span>
            <select
              value={planId}
              onChange={(event) => setPlanId(event.target.value)}
              className="w-fit rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            >
              <option value="">Choose…</option>
              {PLAN_IDS.map((id) => (
                <option key={id} value={id} disabled={id === currentPlanId}>
                  {planDisplayName(id)}
                  {id === currentPlanId ? " — current" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Reason</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. internal account used for platform testing"
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            />
            <span className="text-xs text-muted">
              Recorded against your name in the audit trail. This grants paid entitlements with no
              payment behind them.
            </span>
          </label>

          {ready && (
            <p className="notice notice-warning">
              Move <strong>{customerName}</strong> from {planDisplayName(currentPlanId)} to{" "}
              <strong>{planDisplayName(planId)}</strong>, effective immediately and with nothing
              billed.
            </p>
          )}

          {error && <p className="notice notice-danger">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!ready || busy}
              onClick={() => void submit()}
              className="btn-accent text-sm"
            >
              {busy ? "Setting…" : `Set ${planDisplayName(planId || currentPlanId)} plan`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
