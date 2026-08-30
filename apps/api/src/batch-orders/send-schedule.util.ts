import { BadRequestException } from "@nestjs/common";
import type { PostageClass } from "@prisma/client";
import {
  POSTAGE_LEAD_DAYS,
  computeDispatchDate,
  deliverByWindow,
  sendNowDispatchDate,
  startOfUtcDay,
} from "@kudos/shared-types";

export interface SendSchedule {
  occasionDate: Date;
  dispatchDate: Date;
  scheduled: boolean;
}

/**
 * Turn a requested arrive-by date into the occasion + post-by dates an order
 * line carries, or reject it as unschedulable.
 *
 * `now` is an explicit parameter rather than a `new Date()` inside, because the
 * same-day cut-off is a question about the *time of day* and the whole of ADR
 * 0184 is that it used to be asked of a value that had none.
 */
export function resolveSendSchedule(
  deliverBy: string | undefined,
  postageClass: PostageClass,
  now: Date,
): SendSchedule {
  const today = startOfUtcDay(now);
  if (!deliverBy) {
    // "Send now" posts today only if we're still before the same-day cut-off on
    // a working day; after it (or on a weekend/holiday) it posts the next
    // working day, so the ops queue reads it as due then rather than as
    // overdue-today for a collection that has already gone. See ADR 0160.
    return { occasionDate: today, dispatchDate: sendNowDispatchDate(now), scheduled: false };
  }
  const arriveBy = startOfUtcDay(new Date(`${deliverBy}T00:00:00.000Z`));
  if (Number.isNaN(arriveBy.getTime())) {
    throw new BadRequestException("Invalid delivery date");
  }
  // `now`, not `today`. deliverByWindow asks sendNowDispatchDate whether the
  // same-day cut-off has passed, and that is a question about the time of day:
  // handed a midnight value it always answered "before the cut-off", so the
  // window offered a date one working day sooner than we could really post.
  // The web picker passes the real clock, so the two disagreed all afternoon.
  const { earliest, latest } = deliverByWindow(postageClass, now);
  if (arriveBy.getTime() > startOfUtcDay(latest).getTime()) {
    throw new BadRequestException("That delivery date is too far ahead to schedule.");
  }
  const dispatchDate = computeDispatchDate(arriveBy, POSTAGE_LEAD_DAYS[postageClass]);
  // Compared against the soonest day a card can actually leave, not against the
  // calendar date. After the cut-off nothing posts today, so a post-by date of
  // *today* is already unachievable — and comparing with `today` accepted it,
  // putting a card in the ops queue as due for a collection that had gone.
  const soonestPostingDay = sendNowDispatchDate(now);
  if (dispatchDate.getTime() < soonestPostingDay.getTime()) {
    const soonest = startOfUtcDay(earliest).toISOString().slice(0, 10);
    throw new BadRequestException(
      `That delivery date is too soon — the earliest we can schedule for is ${soonest}.`,
    );
  }
  return { occasionDate: arriveBy, dispatchDate, scheduled: true };
}
