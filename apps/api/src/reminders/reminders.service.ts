import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { EnvConfig } from "../config/env.schema";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";

/** How many days ahead of an occasion we send its reminder. */
const REMINDER_LEAD_DAYS = 7;

/** Occasion states worth reminding about — still upcoming and actionable.
 * `queued` (already in an order) and `skipped` don't need a nudge. */
const REMINDABLE_STATUSES = ["scheduled", "pending_approval", "approved"] as const;

export interface ReminderRunResult {
  accountsEmailed: number;
  occasionsCovered: number;
}

type OccasionWithRecipient = Prisma.OccasionGetPayload<{ include: { recipient: true } }>;

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
  ) {}

  /** Runs after the birthday scheduler (6am) and auto-send (7am) so the day's
   * occasions exist and anything auto-sent is already gone. */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async runDueReminders(): Promise<ReminderRunResult> {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const windowEnd = new Date(today);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + REMINDER_LEAD_DAYS);

    // Occasion has no `account` relation, so resolve the opted-in accounts (with
    // a contact email) first, then filter occasions to them.
    const eligibleAccounts = await this.prisma.account.findMany({
      where: { reminderEmailsEnabled: true, contactEmail: { not: null } },
      select: { id: true, name: true, contactEmail: true },
    });
    if (eligibleAccounts.length === 0) {
      return { accountsEmailed: 0, occasionsCovered: 0 };
    }
    const accountById = new Map(eligibleAccounts.map((account) => [account.id, account]));

    const due = await this.prisma.occasion.findMany({
      where: {
        reminderSentAt: null,
        status: { in: [...REMINDABLE_STATUSES] },
        occasionDate: { gte: today, lte: windowEnd },
        recipientId: { not: null },
        accountId: { in: eligibleAccounts.map((account) => account.id) },
      },
      include: { recipient: true },
      orderBy: { occasionDate: "asc" },
    });

    // Group by account so each customer gets a single digest, not one email per
    // birthday.
    const byAccount = new Map<string, OccasionWithRecipient[]>();
    for (const occasion of due) {
      const list = byAccount.get(occasion.accountId) ?? [];
      list.push(occasion);
      byAccount.set(occasion.accountId, list);
    }

    let accountsEmailed = 0;
    let occasionsCovered = 0;

    for (const [accountId, occasions] of byAccount) {
      const account = accountById.get(accountId);
      if (!account?.contactEmail) continue;

      try {
        await this.email.sendTransactional({
          to: account.contactEmail,
          toName: account.name,
          subject:
            occasions.length === 1
              ? "An upcoming birthday on Kudos"
              : `${occasions.length} upcoming birthdays on Kudos`,
          // If a Brevo template is configured it's used (designed in Brevo);
          // otherwise the built-in HTML below. Template params, for reference
          // when building the Brevo template:
          //   {{ params.name }}          — the account name
          //   {{ params.calendarUrl }}   — link to their calendar
          //   {{ params.birthdays }}     — [{ name, date }] to loop over
          templateId: this.config.get("BREVO_REMINDER_TEMPLATE_ID", { infer: true }),
          params: this.buildDigestParams(account.name, occasions),
          html: this.renderDigest(account.name, occasions),
        });
      } catch (error) {
        // A single account's send failing must not stop the rest, and must not
        // mark its occasions reminded (so the next run retries them).
        const reason = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Reminder email to account ${accountId} failed: ${reason}`);
        continue;
      }

      // Mark only what we actually emailed, so a mid-run failure never silences
      // a not-yet-sent reminder.
      await this.prisma.occasion.updateMany({
        where: { id: { in: occasions.map((o) => o.id) } },
        data: { reminderSentAt: now },
      });
      accountsEmailed += 1;
      occasionsCovered += occasions.length;
    }

    if (accountsEmailed > 0) {
      this.logger.log(
        `Sent ${accountsEmailed} reminder email(s) covering ${occasionsCovered} occasion(s)`,
      );
    }
    return { accountsEmailed, occasionsCovered };
  }

  /** Dynamic values a Brevo reminder template can render. */
  private buildDigestParams(
    accountName: string,
    occasions: OccasionWithRecipient[],
  ): Record<string, unknown> {
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    return {
      name: accountName,
      calendarUrl: `${webAppUrl}/calendar`,
      birthdays: occasions.map((occasion) => ({
        name: occasion.recipient
          ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
          : "A recipient",
        date: occasion.occasionDate.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        }),
      })),
    };
  }

  private renderDigest(accountName: string, occasions: OccasionWithRecipient[]): string {
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const rows = occasions
      .map((occasion) => {
        const name = occasion.recipient
          ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
          : "A recipient";
        const date = occasion.occasionDate.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        });
        return `<li style="margin-bottom:6px"><strong>${escapeHtml(name)}</strong> — ${date}</li>`;
      })
      .join("");

    return `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
        <h1 style="font-size:20px">Upcoming birthdays</h1>
        <p>Hi ${escapeHtml(accountName)}, these birthdays are coming up:</p>
        <ul style="padding-left:18px">${rows}</ul>
        <p style="margin-top:20px">
          <a href="${webAppUrl}/calendar"
             style="background:#ef5b52;color:#fff;padding:10px 18px;border-radius:9999px;text-decoration:none;font-weight:600">
            Review &amp; send in Kudos
          </a>
        </p>
        <p style="color:#64748b;font-size:12px;margin-top:24px">
          You can turn these reminders off in your Kudos billing settings.
        </p>
      </div>`;
  }
}

/** Minimal HTML escaping for names interpolated into the email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
