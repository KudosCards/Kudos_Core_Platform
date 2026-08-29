import type { Prisma, PrismaClient } from "@prisma/client";
import { BIRTHDAY_LOOKAHEAD_DAYS } from "./occasion-scheduling.constants";
import { startOfUtcDay } from "./birthday-occasion.util";

/** Anything that can run the update: the PrismaService or a transaction client. */
type PrismaLike = Pick<PrismaClient, "occasion"> | Prisma.TransactionClient;

/**
 * Move recurring occasions that have entered the approval window from
 * `scheduled` to `pending_approval`.
 *
 * The one rule for "this is close enough to act on", so the nightly scheduler
 * and the eager paths that create occasions when a contact is added cannot
 * drift apart on it.
 *
 * Extracted because they *had* drifted, in the way that only shows up on a big
 * import. Adding a contact eagerly creates their birthday as `scheduled` — right
 * for a birthday months away, wrong for one nine days out — and nothing promoted
 * it until the 06:00 cron. So someone who imported two thousand contacts saw a
 * full calendar and an Approvals page reading "Nothing waiting for approval
 * right now", for up to twenty-four hours, with nothing to tell them the two
 * screens were describing the same data at different points in time.
 *
 * Scope it to an account when a specific account just changed; leave it off for
 * the platform-wide nightly sweep.
 */
export async function promoteDueOccasions(
  prisma: PrismaLike,
  accountId?: string,
  now: Date = new Date(),
): Promise<number> {
  const lookaheadEnd = startOfUtcDay(now);
  lookaheadEnd.setUTCDate(lookaheadEnd.getUTCDate() + BIRTHDAY_LOOKAHEAD_DAYS);

  const { count } = await prisma.occasion.updateMany({
    where: {
      ...(accountId ? { accountId } : {}),
      // Only the recurring types are promoted on a timer. The rest are created
      // by a human, who has already decided they want them.
      type: { in: ["birthday", "renewal", "anniversary"] },
      status: "scheduled",
      // Bounded at both ends. The upper bound is the approval window; the lower
      // bound is today, because an occasion whose date has been cannot be
      // delivered and has no business arriving in a queue that asks someone to
      // act on it. This used to rely on `nextBirthdayOccurrence` never returning
      // a past date — true of the moment an occasion is created, and irrelevant
      // afterwards: one created for a birthday nine days out is still sitting
      // there, unactioned, three weeks later with its date long gone.
      occasionDate: { gte: startOfUtcDay(now), lte: lookaheadEnd },
      // Don't pull an archived recipient's occasion into the approvals queue.
      recipient: { status: "active" },
    },
    data: { status: "pending_approval" },
  });
  return count;
}
