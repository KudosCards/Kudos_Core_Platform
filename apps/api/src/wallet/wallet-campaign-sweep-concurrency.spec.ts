import type { WalletCampaign } from "@prisma/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrismaService } from "../prisma/prisma.service";
import type { PlatformNotificationService } from "../platform-notifications/platform-notification.service";
import type { WalletService } from "./wallet.service";
import { CAMPAIGN_SWEEP_CONCURRENCY, WalletCampaignsService } from "./wallet-campaigns.service";

/**
 * How the sweep spends its concurrency, and what it does with a credit it could
 * not make.
 *
 * A serialization race cannot be asserted by running it and hoping, so these
 * pin the *invariant* instead: a credit is never in flight beside another for
 * the same campaign, while the address lookups beside it still are. Both halves
 * matter — serialising everything would satisfy the first assertion by throwing
 * away the concurrency the sweep actually needs.
 *
 * See the comment on `sweepOne` for why the race is structural rather than
 * unlucky.
 */
describe("the sweep's concurrency", () => {
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const campaign = {
    id: "camp-1",
    name: "Launch",
    amountMinor: 500,
    budgetMinor: 1_000_000,
    status: "live",
    startsAt: new Date("2020-01-01T00:00:00Z"),
    endsAt: new Date("2030-01-01T00:00:00Z"),
  } as unknown as WalletCampaign;

  /** Records the high-water mark of overlapping calls to whatever it wraps. */
  function meter() {
    const state = { inFlight: 0, peak: 0, order: [] as string[] };
    return {
      state,
      async run<T>(label: string, work: () => Promise<T>): Promise<T> {
        state.inFlight += 1;
        state.peak = Math.max(state.peak, state.inFlight);
        state.order.push(label);
        try {
          return await work();
        } finally {
          state.inFlight -= 1;
        }
      },
    };
  }

  interface Harness {
    service: WalletCampaignsService;
    credits: ReturnType<typeof meter>["state"];
    lookups: ReturnType<typeof meter>["state"];
    creditCampaign: jest.Mock;
  }

  function harness(
    accountIds: string[],
    creditOutcome: (accountId: string) => Promise<unknown> = () =>
      Promise.resolve({ status: "credited", amountMinor: 500 }),
    options: { owners?: boolean } = {},
  ): Harness {
    const credits = meter();
    const lookups = meter();

    const candidates = accountIds.map((id) => ({
      id,
      memberships: options.owners === false ? [] : [{ userId: `user-${id}` }],
    }));

    const prisma = {
      walletCampaign: { findMany: () => Promise.resolve([campaign]) },
      account: { findMany: () => Promise.resolve(candidates) },
      // Only `markExhaustedIfSpent` opens one, and it must decide "not spent".
      $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          walletCampaign: { findUnique: () => Promise.resolve(campaign) },
          walletLedgerEntry: { aggregate: () => Promise.resolve({ _sum: { amountMinor: 0 } }) },
        }),
    } as unknown as PrismaService;

    const creditCampaign = jest.fn((accountId: string) =>
      credits.run(accountId, async () => {
        // Long enough that a second credit starting beside this one would be
        // seen by the meter rather than slipping between two microtasks.
        await sleep(5);
        return creditOutcome(accountId);
      }),
    );

    const supabaseAdmin = {
      auth: {
        admin: {
          getUserById: (userId: string) =>
            lookups.run(userId, async () => {
              await sleep(5);
              return {
                data: {
                  user: { email: `${userId}@example.com`, email_confirmed_at: "2026-01-01" },
                },
                error: null,
              };
            }),
        },
      },
    } as unknown as SupabaseClient;

    const service = new WalletCampaignsService(
      prisma,
      { creditCampaign } as unknown as WalletService,
      { notifyAllAdmins: () => Promise.resolve() } as unknown as PlatformNotificationService,
      supabaseAdmin,
    );

    return { service, credits: credits.state, lookups: lookups.state, creditCampaign };
  }

  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("never has two credits for one campaign in flight at once", async () => {
    // The defect this exists to prevent: `creditCampaign` sums every ledger row
    // for the campaign and then inserts one into that same set, so two at once
    // is a serialization cycle by construction, and a loser that exhausts its
    // retries leaves an eligible customer unpaid.
    const { service, credits } = harness(["a", "b", "c", "d", "e", "f", "g", "h"]);

    const summary = await service.sweep();

    expect(credits.peak).toBe(1);
    expect(summary.credited).toBe(8);
    expect(summary.failed).toBe(0);
  });

  it("still looks the addresses up concurrently", async () => {
    // The other half. Serialising the whole batch would pass the test above
    // while throwing away the only concurrency that was ever worth having —
    // a Supabase round trip per account, which contends with nothing.
    const { service, lookups } = harness(["a", "b", "c", "d", "e", "f", "g", "h"]);

    await service.sweep();

    expect(lookups.peak).toBe(CAMPAIGN_SWEEP_CONCURRENCY);
  });

  it("credits in sign-up order, so a budget that runs out pays the earliest", async () => {
    // The candidates arrive ordered by `createdAt`. Crediting in whatever order
    // four addresses happened to resolve would make "who got paid" a race.
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const { service, credits } = harness(ids);

    await service.sweep();

    expect(credits.order).toEqual(ids);
  });

  it("counts a credit that threw as failed, not skipped", async () => {
    // A serialization conflict that exhausts its retries arrives here. Counting
    // it as "skipped" filed money we owe under accounts we deliberately passed
    // over, which is the one thing an operator needs to tell apart.
    const { service } = harness(["a", "b"], (accountId) =>
      accountId === "a"
        ? Promise.reject(new Error("The server is busy with a conflicting change."))
        : Promise.resolve({ status: "credited", amountMinor: 500 }),
    );

    const summary = await service.sweep();

    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.credited).toBe(1);
  });

  it("counts an ineligible account as skipped, not failed", async () => {
    // The contrast: nothing is owed and nothing is wrong, so it must not land
    // in the counter that says money went missing.
    const { service } = harness(["a", "b"], () =>
      Promise.resolve({ status: "not_eligible", reason: "email_unverified" }),
    );

    const summary = await service.sweep();

    expect(summary.skipped).toBe(2);
    expect(summary.failed).toBe(0);
  });

  it("never attempts a credit it has no address lookup for", async () => {
    // The eligibility query already required an owner membership, so an account
    // arriving here without one lost a race — it is owed a credit we could not
    // make, not an account we chose to pass over.
    const { service, creditCampaign } = harness(["a"], undefined, { owners: false });

    const summary = await service.sweep();

    expect(creditCampaign).not.toHaveBeenCalled();
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(0);
  });

  it("stops the batch within one window of the budget running out", async () => {
    // Windowed rather than two passes: the whole point is not to spend 200
    // Supabase round trips on a campaign that can afford no more credits.
    const ids = Array.from({ length: 16 }, (_, i) => `a${i}`);
    const { service, credits, lookups } = harness(ids, () =>
      Promise.resolve({ status: "budget_exhausted" }),
    );

    await service.sweep();

    // The first credit of the first window refuses, so nothing past that window
    // is credited — or even looked up.
    expect(credits.order).toEqual(["a0"]);
    expect(lookups.order).toHaveLength(CAMPAIGN_SWEEP_CONCURRENCY);
  });
});
