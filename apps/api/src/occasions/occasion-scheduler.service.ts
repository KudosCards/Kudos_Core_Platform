import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { BIRTHDAY_LOOKAHEAD_DAYS, computeDispatchDate } from "./occasion-scheduling.constants";
import { nextBirthdayOccurrence } from "./next-birthday.util";

/**
 * Only birthdays are auto-scheduled — see docs/adr/0006-phase-2-scope.md for
 * why the other five OccasionTypes are always created manually via the API.
 */
@Injectable()
export class OccasionSchedulerService {
  private readonly logger = new Logger(OccasionSchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async scheduleBirthdayOccasions(): Promise<number> {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const lookaheadEnd = new Date(today);
    lookaheadEnd.setUTCDate(lookaheadEnd.getUTCDate() + BIRTHDAY_LOOKAHEAD_DAYS);

    const recipients = await this.prisma.recipient.findMany({
      where: { status: "active", dateOfBirth: { not: null } },
      select: { id: true, accountId: true, dateOfBirth: true },
    });

    const candidates = recipients
      .map((recipient) => ({
        recipient,
        occasionDate: nextBirthdayOccurrence(recipient.dateOfBirth as Date, today),
      }))
      .filter(({ occasionDate }) => occasionDate <= lookaheadEnd);

    if (candidates.length === 0) {
      this.logger.log(`No birthdays within the next ${BIRTHDAY_LOOKAHEAD_DAYS} days`);
      return 0;
    }

    // skipDuplicates makes this idempotent against occasion_idempotency_key —
    // re-running the job (or a retry) never double-creates an occasion.
    const { count } = await this.prisma.occasion.createMany({
      data: candidates.map(({ recipient, occasionDate }) => ({
        accountId: recipient.accountId,
        recipientId: recipient.id,
        type: "birthday" as const,
        source: "recurring_per_recipient" as const,
        occasionDate,
        dispatchDate: computeDispatchDate(occasionDate),
        status: "pending_approval" as const,
      })),
      skipDuplicates: true,
    });

    this.logger.log(
      `Scheduled ${count} new birthday occasion(s) (${candidates.length} candidates within ${BIRTHDAY_LOOKAHEAD_DAYS} days)`,
    );
    return count;
  }
}
