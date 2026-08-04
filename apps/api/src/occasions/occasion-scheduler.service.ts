import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { BIRTHDAY_LOOKAHEAD_DAYS } from "./occasion-scheduling.constants";
import { buildScheduledBirthdayOccasion, startOfUtcDay } from "./birthday-occasion.util";
import { buildScheduledKeyDateOccasion } from "./key-date-occasion.util";

/**
 * Only birthdays are auto-scheduled — see docs/adr/0006-phase-2-scope.md for
 * why the other five OccasionTypes are always created manually via the API.
 *
 * The job has two jobs (both idempotent, so a retry is a safe no-op):
 *   1. Ensure every active recipient with a DOB has a `scheduled` birthday
 *      occasion for their next birthday — so the calendar is always populated,
 *      even for birthdays that are months away. (Recipients created through the
 *      app already get this eagerly on add; this is the catch-all for legacy
 *      rows, DOBs added later via a CRM sync, and rolling to next year's date
 *      once this year's birthday has passed.)
 *   2. Promote the `scheduled` birthday occasions that have entered the
 *      lookahead window to `pending_approval`, so they surface in the approvals
 *      queue and the existing approve → order → dispatch flow takes over.
 * See docs/adr/0016-recipient-events-and-lists.md.
 */
@Injectable()
export class OccasionSchedulerService {
  private readonly logger = new Logger(OccasionSchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async scheduleBirthdayOccasions(): Promise<number> {
    const today = startOfUtcDay(new Date());
    const lookaheadEnd = new Date(today);
    lookaheadEnd.setUTCDate(lookaheadEnd.getUTCDate() + BIRTHDAY_LOOKAHEAD_DAYS);

    const recipients = await this.prisma.recipient.findMany({
      where: { status: "active", dateOfBirth: { not: null } },
      select: { id: true, accountId: true, dateOfBirth: true },
    });

    // 1. Ensure a scheduled birthday occasion exists for every recipient's next
    //    birthday. skipDuplicates + occasion_idempotency_key make this a no-op
    //    for occasions that already exist (whatever their current status).
    if (recipients.length > 0) {
      await this.prisma.occasion.createMany({
        data: recipients.map((recipient) =>
          buildScheduledBirthdayOccasion(
            { id: recipient.id, accountId: recipient.accountId, dateOfBirth: recipient.dateOfBirth as Date },
            today,
          ),
        ),
        skipDuplicates: true,
      });
    }

    // 1b. Same for renewal/anniversary key dates — ensure each has a scheduled
    //     occasion for its next annual occurrence. Recipients created/edited
    //     through the app get this eagerly (recipients.service); this is the
    //     catch-all + the yearly roll-forward once a date has passed.
    const keyDates = await this.prisma.recipientKeyDate.findMany({
      where: { recipient: { status: "active" } },
      select: { accountId: true, recipientId: true, type: true, date: true, label: true },
    });
    if (keyDates.length > 0) {
      await this.prisma.occasion.createMany({
        data: keyDates.map((keyDate) => buildScheduledKeyDateOccasion(keyDate, today)),
        skipDuplicates: true,
      });
    }

    // 2. Promote the recurring occasions now within the lookahead window into the
    //    approvals queue. Their occasionDate is always today-or-later
    //    (nextBirthdayOccurrence never returns a past date), so an upper bound is
    //    all that's needed.
    const { count } = await this.prisma.occasion.updateMany({
      where: {
        type: { in: ["birthday", "renewal", "anniversary"] },
        status: "scheduled",
        occasionDate: { lte: lookaheadEnd },
        // Don't pull an archived recipient's occasion into the approvals queue.
        recipient: { status: "active" },
      },
      data: { status: "pending_approval" },
    });

    this.logger.log(
      `Recurring scheduler: ${recipients.length} recipient(s) with a DOB, ${keyDates.length} key date(s), ${count} occasion(s) promoted into the ${BIRTHDAY_LOOKAHEAD_DAYS}-day approval window`,
    );
    return count;
  }
}
