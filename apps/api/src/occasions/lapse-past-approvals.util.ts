import type { Prisma, PrismaClient } from "@prisma/client";
import { startOfUtcDay } from "./birthday-occasion.util";

/** Anything that can run the update: the PrismaService or a transaction client. */
type PrismaLike = Pick<PrismaClient, "occasion"> | Prisma.TransactionClient;

/**
 * Retire the occasions sitting in the approvals queue whose date has already
 * been. Their card cannot be delivered, so there is nothing left to approve.
 *
 * Written because the queue had no exit. An occasion promoted into Approvals
 * that nobody actioned stayed there for ever, its date sliding quietly into the
 * past, and the pile grew for as long as the account existed. A customer
 * migrated in mid-August had seventeen dead entries by the end of the month; a
 * year-old account would have hundreds.
 *
 * That pile is not merely untidy — it is dangerous. Faced with a queue of
 * birthdays they could no longer do anything about, one customer cleared it by
 * hand: twenty-seven clicks of "Skip" at roughly one a second. Ten of those were
 * live birthdays still weeks away, and skipping them meant the cards they then
 * paid for went out as a single undated batch instead of on each child's day.
 * The queue caused the sweeping, and the sweeping caused the loss.
 *
 * `skipped` rather than a status of its own: a lapse and a deliberate skip are
 * already distinguishable without one — a lapsed occasion is always in the past,
 * and a deliberate skip leaves an audit entry naming who did it. A new enum
 * value would ripple through every status filter in the codebase to record
 * something two existing facts already say. No per-occasion audit either: this
 * runs platform-wide with no human behind it, and `actorUserId` is required, so
 * a row per occasion would mean thousands of entries attributed to an invented
 * user. The run logs its count instead.
 *
 * Scope it to an account to repair one; leave it off for the nightly sweep.
 */
export async function lapsePastApprovals(
  prisma: PrismaLike,
  accountId?: string,
  now: Date = new Date(),
): Promise<number> {
  const { count } = await prisma.occasion.updateMany({
    where: {
      ...(accountId ? { accountId } : {}),
      status: "pending_approval",
      // Strictly before today. A birthday *today* is left alone: it is too late
      // to arrive on the day, but sending it late is the customer's call to
      // make, not ours to take away.
      occasionDate: { lt: startOfUtcDay(now) },
    },
    data: { status: "skipped" },
  });
  return count;
}
