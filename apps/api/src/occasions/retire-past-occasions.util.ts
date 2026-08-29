import type { Prisma, PrismaClient } from "@prisma/client";
import { startOfUtcDay } from "./birthday-occasion.util";

/** Anything that can run the update: the PrismaService or a transaction client. */
type PrismaLike = Pick<PrismaClient, "occasion"> | Prisma.TransactionClient;

/**
 * Close off the dates that have been and gone with no card sent.
 *
 * Three things used to outlive their own date, each in a different way:
 *
 *   1. **An approval nobody actioned.** The queue had no exit, so the pile grew
 *      for as long as the account existed. A customer facing birthdays they
 *      could no longer act on cleared it by hand — twenty-seven clicks of
 *      "Skip", ten of them live birthdays still weeks away. The queue caused
 *      the sweeping and the sweeping caused the loss.
 *   2. **An approval the customer *did* action.** Approved, a design chosen,
 *      and then never ordered. Nothing retired it, so it kept a green badge
 *      reading "Ready to send" on a birthday five weeks past. One real contact
 *      had a card approved three days *after* the birthday had already gone.
 *   3. **A hand-added event.** Only birthdays, renewals and anniversaries are
 *      promoted on a timer, so a graduation or a leaver's date sat "Scheduled"
 *      for ever with a live "Prepare card" button beside it.
 *
 * All three become `missed`, not `skipped`. `skipped` is a person's decision and
 * carries an audit entry naming them; `missed` is a date that went by. Telling a
 * customer they skipped a birthday they never touched reads as an accusation,
 * and it hid case 2 completely — the failure looked like a choice.
 *
 * A card that is already paid for and in production is never touched: those
 * statuses mean money has been spent and the occasion is part of an order's
 * history.
 *
 * No per-occasion audit: this runs platform-wide with no human behind it, and
 * `actorUserId` is required, so a row per occasion would mean thousands of
 * entries attributed to an invented user. The run logs its counts instead.
 *
 * Scope it to an account to repair one; leave it off for the nightly sweep.
 * See docs/adr/0174 and docs/adr/0178.
 */
export interface RetiredCounts {
  /** Approvals nobody actioned, and approvals that were never ordered. */
  approvals: number;
  /** Hand-added events whose day passed without a card being prepared. */
  events: number;
}

export async function retirePastOccasions(
  prisma: PrismaLike,
  accountId?: string,
  now: Date = new Date(),
): Promise<RetiredCounts> {
  // Strictly before today. An occasion dated *today* is left alone: it is too
  // late to arrive on the day, but sending it late is the customer's call to
  // make, not ours to take away.
  const before = { lt: startOfUtcDay(now) };
  const scope = accountId ? { accountId } : {};

  const { count: approvals } = await prisma.occasion.updateMany({
    where: { ...scope, status: { in: ["pending_approval", "approved"] }, occasionDate: before },
    data: { status: "missed" },
  });

  // `scheduled` recurring occasions are not swept: the scheduler rolls a
  // birthday forward to next year's date rather than leaving last year's
  // behind, so a past `scheduled` birthday is a transient state between the
  // date passing and the next nightly run — not a dead row. A one-off event is
  // the opposite: nothing ever moves it, so its date passing is terminal.
  const { count: events } = await prisma.occasion.updateMany({
    where: {
      ...scope,
      status: "scheduled",
      source: "one_off_campaign",
      occasionDate: before,
    },
    data: { status: "missed" },
  });

  return { approvals, events };
}
