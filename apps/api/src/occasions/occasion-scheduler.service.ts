import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { BIRTHDAY_LOOKAHEAD_DAYS } from "./occasion-scheduling.constants";
import { buildScheduledBirthdayOccasion, startOfUtcDay } from "./birthday-occasion.util";
import { buildScheduledKeyDateOccasion } from "./key-date-occasion.util";

/**
 * How many rows the recurring scheduler pulls per page. The job runs across
 * EVERY tenant's contacts, so it must never load the whole table into memory —
 * it keyset-paginates on the primary key (stable, index-backed) and writes each
 * page's occasions before fetching the next, keeping memory flat regardless of
 * how large the platform grows. See docs/adr/0154.
 */
const SCHEDULER_PAGE_SIZE = 1_000;

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

    // 1. Ensure a scheduled birthday occasion exists for every recipient's next
    //    birthday, and (1b) the same for renewal/anniversary key dates. Both
    //    stream through the tables in pages rather than materialising them whole.
    //    skipDuplicates + the occasion idempotency key make each write a no-op
    //    for occasions that already exist (whatever their current status).
    const recipientCount = await this.ensureScheduledBirthdays(today);
    const keyDateCount = await this.ensureScheduledKeyDates(today);

    // 2. Promote the recurring occasions now within the lookahead window into the
    //    approvals queue. Their occasionDate is always today-or-later
    //    (nextBirthdayOccurrence never returns a past date), so an upper bound is
    //    all that's needed. This is a single set-based UPDATE — no rows are read
    //    into the app, so it scales without a page loop.
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
      `Recurring scheduler: ${recipientCount} recipient(s) with a DOB, ${keyDateCount} key date(s), ${count} occasion(s) promoted into the ${BIRTHDAY_LOOKAHEAD_DAYS}-day approval window`,
    );
    return count;
  }

  /**
   * Ensure a `scheduled` birthday occasion exists for every active recipient
   * with a DOB. Keyset-paginated on `recipient.id` so memory stays flat: each
   * page is written and discarded before the next is fetched. Returns the number
   * of recipients seen (for the run log), not the number of occasions created —
   * skipDuplicates means most pages create nothing on a steady-state run.
   */
  private async ensureScheduledBirthdays(today: Date): Promise<number> {
    let processed = 0;
    let cursor: string | undefined;

    for (;;) {
      const recipients = await this.prisma.recipient.findMany({
        where: { status: "active", dateOfBirth: { not: null } },
        select: { id: true, accountId: true, dateOfBirth: true },
        orderBy: { id: "asc" },
        take: SCHEDULER_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (recipients.length === 0) break;

      await this.prisma.occasion.createMany({
        data: recipients.map((recipient) =>
          buildScheduledBirthdayOccasion(
            {
              id: recipient.id,
              accountId: recipient.accountId,
              dateOfBirth: recipient.dateOfBirth as Date,
            },
            today,
          ),
        ),
        skipDuplicates: true,
      });

      processed += recipients.length;
      cursor = recipients[recipients.length - 1]!.id;
      if (recipients.length < SCHEDULER_PAGE_SIZE) break;
    }

    return processed;
  }

  /**
   * Same catch-all + yearly roll-forward for renewal/anniversary key dates as
   * `ensureScheduledBirthdays` does for birthdays. Keyset-paginated on
   * `recipientKeyDate.id`.
   */
  private async ensureScheduledKeyDates(today: Date): Promise<number> {
    let processed = 0;
    let cursor: string | undefined;

    for (;;) {
      const keyDates = await this.prisma.recipientKeyDate.findMany({
        where: { recipient: { status: "active" } },
        select: { id: true, accountId: true, recipientId: true, type: true, date: true, label: true },
        orderBy: { id: "asc" },
        take: SCHEDULER_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (keyDates.length === 0) break;

      await this.prisma.occasion.createMany({
        data: keyDates.map((keyDate) => buildScheduledKeyDateOccasion(keyDate, today)),
        skipDuplicates: true,
      });

      processed += keyDates.length;
      cursor = keyDates[keyDates.length - 1]!.id;
      if (keyDates.length < SCHEDULER_PAGE_SIZE) break;
    }

    return processed;
  }
}
