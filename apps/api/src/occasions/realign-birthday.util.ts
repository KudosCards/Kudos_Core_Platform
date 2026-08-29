import type { Prisma, PrismaClient } from "@prisma/client";
import { COMMITTED_OCCASION_STATUSES } from "@kudos/shared-types";
import { startOfUtcDay } from "./birthday-occasion.util";
import { nextBirthdayOccurrence } from "./next-birthday.util";
import { computeDispatchDate } from "./occasion-scheduling.constants";

type PrismaLike = Pick<PrismaClient, "occasion"> | Prisma.TransactionClient;

export interface RealignResult {
  /** The occasion moved onto the corrected date, if there was one to move. */
  moved: boolean;
  /** Extra rows whose date had already been, closed off as `missed`. */
  retired: number;
  /** Extra rows still in the future, removed outright — see `discardLosers`. */
  discarded: number;
  /** A fresh `scheduled` occasion was created because none could be moved. */
  created: boolean;
}

/**
 * Clear the birthday rows that lost the date.
 *
 * Only one row can hold a given (recipient, type, date), so a correction that
 * leaves several live birthdays has to end all but one. How it ends them
 * depends on whether their day has been:
 *
 *   - **Already past** → `missed`, which is exactly what it is.
 *   - **Still ahead** → removed. It is a duplicate that should never have
 *     existed, nothing was ordered against it (a committed card is filtered out
 *     before this point), and no card was sent or ever going to be. Marking it
 *     `missed` would put "the date passed and no card was sent" on the
 *     contact's timeline against a date that has not passed — which is the
 *     kind of small, confident falsehood that makes a customer distrust
 *     everything else on the page.
 */
async function discardLosers(
  prisma: PrismaLike,
  losers: { id: string; occasionDate: Date }[],
  today: Date,
): Promise<{ retired: number; discarded: number }> {
  const past = losers.filter((o) => o.occasionDate.getTime() < today.getTime());
  const ahead = losers.filter((o) => o.occasionDate.getTime() >= today.getTime());

  let retired = 0;
  if (past.length > 0) {
    ({ count: retired } = await prisma.occasion.updateMany({
      where: { id: { in: past.map((o) => o.id) } },
      data: { status: "missed" },
    }));
  }

  let discarded = 0;
  if (ahead.length > 0) {
    ({ count: discarded } = await prisma.occasion.deleteMany({
      where: { id: { in: ahead.map((o) => o.id) } },
    }));
  }

  return { retired, discarded };
}

/**
 * Re-point a contact's birthday at a corrected date of birth.
 *
 * Correcting a date of birth used to delete only the `scheduled` birthday and
 * create a new one. Anything already promoted — sitting in Approvals, or
 * approved with a design chosen — was left behind on the old date, for ever.
 * One real contact accumulated three birthdays across four corrections: one
 * approved on 24 July, one awaiting approval on 9 August, and the right one on
 * 23 October. From the customer's side their contact simply had three birthdays
 * and no explanation.
 *
 * So the live occasion is *moved* instead of orphaned. The approval and the
 * chosen design survive the correction, which is what someone fixing a typo
 * expects: they changed a date, not their mind about the card.
 *
 * Two things are never moved:
 *
 *   - A card already paid for and in production (`queued` and beyond). The
 *     money is spent and the occasion is part of an order's history; it is left
 *     exactly where it is and a fresh occasion is created for the new date.
 *   - Anything already closed (`skipped`, `missed`, `delivered`) — those are
 *     history too.
 *
 * Only one row can hold a given (recipient, type, date), so where a correction
 * leaves several live birthdays the furthest-along one is moved and the rest
 * are retired as `missed`. That is the repair case: contacts that already carry
 * stale rows converge on a single correct birthday the first time their date of
 * birth is touched.
 */
const LIVE_ORDER = ["approved", "pending_approval", "scheduled"] as const;

export async function realignBirthdayOccasion(
  prisma: PrismaLike,
  input: { accountId: string; recipientId: string; dateOfBirth: Date | null },
  now: Date = new Date(),
): Promise<RealignResult> {
  const today = startOfUtcDay(now);

  const live = await prisma.occasion.findMany({
    where: {
      recipientId: input.recipientId,
      accountId: input.accountId,
      type: "birthday",
      status: { in: [...LIVE_ORDER] },
    },
    select: { id: true, status: true, occasionDate: true },
  });

  // No date of birth any more: there is no birthday to hold, so every live row
  // goes. (A committed card is untouched by the filter above.)
  if (!input.dateOfBirth) {
    if (live.length === 0) return { moved: false, retired: 0, discarded: 0, created: false };
    const { retired, discarded } = await discardLosers(prisma, live, today);
    return { moved: false, retired, discarded, created: false };
  }

  const target = nextBirthdayOccurrence(input.dateOfBirth, today);
  const targetTime = target.getTime();

  // Already correct: nothing to do beyond clearing any duplicates.
  const onTarget = live.filter((o) => o.occasionDate.getTime() === targetTime);
  const offTarget = live.filter((o) => o.occasionDate.getTime() !== targetTime);

  // The furthest-along row wins the date — an approval with a design chosen is
  // worth more than a bare scheduled row.
  const rank = (status: string) => LIVE_ORDER.indexOf(status as (typeof LIVE_ORDER)[number]);
  const keeper = onTarget[0] ?? [...offTarget].sort((a, b) => rank(a.status) - rank(b.status))[0];

  const losers = live.filter((o) => o.id !== keeper?.id);
  const { retired, discarded } =
    losers.length > 0 ? await discardLosers(prisma, losers, today) : { retired: 0, discarded: 0 };

  if (!keeper) {
    // Nothing live to move — every birthday row is committed or closed. The
    // contact still needs their next birthday on the calendar.
    await prisma.occasion.createMany({
      data: [
        {
          accountId: input.accountId,
          recipientId: input.recipientId,
          type: "birthday",
          source: "recurring_per_recipient",
          occasionDate: target,
          dispatchDate: computeDispatchDate(target),
          status: "scheduled",
        },
      ],
      skipDuplicates: true,
    });
    return { moved: false, retired, discarded, created: true };
  }

  if (keeper.occasionDate.getTime() === targetTime) {
    return { moved: false, retired, discarded, created: false };
  }

  await prisma.occasion.update({
    where: { id: keeper.id },
    data: { occasionDate: target, dispatchDate: computeDispatchDate(target) },
  });
  return { moved: true, retired, discarded, created: false };
}

/** Statuses a birthday occasion can be in and still be moved. Exported so the
 * repair script and the tests share one definition with the rule above. */
export const MOVABLE_BIRTHDAY_STATUSES = LIVE_ORDER;
export { COMMITTED_OCCASION_STATUSES };
