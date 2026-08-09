import {
  BILLING_MIGRATION_TAG,
  buildSubscriptionParams,
  resolveBillingAction,
  toUnixSeconds,
} from "./woocommerce-billing";

const NOW = new Date("2026-08-09T00:00:00Z");
const FUTURE = "2026-08-23T16:35:03.000Z";

describe("toUnixSeconds", () => {
  it("converts an ISO string to epoch seconds and handles empties", () => {
    expect(toUnixSeconds("2026-08-23T16:35:03.000Z")).toBe(1787502903);
    expect(toUnixSeconds(null)).toBeNull();
    expect(toUnixSeconds("not-a-date")).toBeNull();
  });
});

describe("resolveBillingAction", () => {
  const base = {
    stripeCustomerId: "cus_ABC",
    stripePaymentMethodId: "pm_ABC",
    nextPaymentAt: FUTURE,
  };

  it("creates with a trial anchored to the next-payment date", () => {
    const action = resolveBillingAction(base, NOW);
    expect(action).toEqual({ kind: "create", trialEndUnix: toUnixSeconds(FUTURE) });
  });

  it("skips an account with no Stripe customer (comp/manual)", () => {
    const action = resolveBillingAction({ ...base, stripeCustomerId: null }, NOW);
    expect(action).toEqual({ kind: "skip", reason: expect.stringContaining("No Stripe customer") });
  });

  it("skips when there's no saved payment method", () => {
    const action = resolveBillingAction({ ...base, stripePaymentMethodId: null }, NOW);
    expect(action.kind).toBe("skip");
    if (action.kind === "skip") {
      expect(action.reason).toContain("No saved payment method");
    }
  });

  it("skips when the export has no next-payment date", () => {
    const action = resolveBillingAction({ ...base, nextPaymentAt: null }, NOW);
    expect(action.kind).toBe("skip");
  });

  it("skips a next-payment date already in the past (would charge immediately)", () => {
    const action = resolveBillingAction({ ...base, nextPaymentAt: "2026-08-01T00:00:00Z" }, NOW);
    expect(action.kind).toBe("skip");
    if (action.kind === "skip") {
      expect(action.reason).toContain("past or too soon");
    }
  });

  it("skips a date inside the minimum lead window", () => {
    const soon = new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(); // +10 min
    const action = resolveBillingAction({ ...base, nextPaymentAt: soon }, NOW);
    expect(action.kind).toBe("skip");
  });
});

describe("buildSubscriptionParams", () => {
  it("builds Stripe create params with the trial anchor and webhook metadata", () => {
    const params = buildSubscriptionParams({
      customer: "cus_ABC",
      priceId: "price_pro",
      paymentMethod: "pm_ABC",
      trialEndUnix: 1787502903,
      accountId: "acc-1",
      planId: "pro",
      wooSubscriptionId: "5027",
    });
    expect(params).toEqual({
      customer: "cus_ABC",
      items: [{ price: "price_pro" }],
      default_payment_method: "pm_ABC",
      trial_end: 1787502903,
      proration_behavior: "none",
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      metadata: {
        accountId: "acc-1",
        planId: "pro",
        migratedFrom: BILLING_MIGRATION_TAG,
        wooSubscriptionId: "5027",
      },
    });
  });
});
