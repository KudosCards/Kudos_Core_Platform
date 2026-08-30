import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { EnvConfig } from "../config/env.schema";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { BRAND, escapeHtml, renderBrandedEmail } from "../email/email-layout";
import { PLATFORM_TIME_ZONE } from "../common/scheduling";

/**
 * How many days before the card's **posting deadline** we send its reminder.
 *
 * Deliberately measured against `dispatchDate`, not `occasionDate`. The two are
 * not a fixed distance apart: the deadline is five *working* days before the
 * date (ADR 0115), which stretches to eight, eleven or twelve calendar days
 * across a bank holiday or the December rush. Counting back from the occasion
 * therefore sent the warning after the card had to be in the post — measured
 * first-class, before the fix:
 *
 *   occasion 2026-05-28 (Thu)  must post 20 May  reminder 21 May  1 day late
 *   occasion 2026-04-10 (Fri)  must post  1 Apr  reminder  3 Apr  2 days late
 *   occasion 2026-12-31 (Thu)  must post 17 Dec  reminder 24 Dec  7 days late
 *
 * And the ordinary weekday case had no slack at all — the reminder landed on
 * the deadline itself. See ADR 0183.
 */
const REMINDER_LEAD_DAYS = 7;

/** Occasion states worth reminding about — still upcoming and actionable.
 * `queued` (already in an order) and `skipped` don't need a nudge. */
const REMINDABLE_STATUSES = ["scheduled", "pending_approval", "approved"] as const;

export interface ReminderRunResult {
  accountsEmailed: number;
  occasionsCovered: number;
}

type OccasionWithRecipient = Prisma.OccasionGetPayload<{ include: { recipient: true } }>;

/** "3 December" — the one date format these emails use. */
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** The line that tells a customer what they actually have to beat. Without it a
 * reminder is only news, not something that can be acted on correctly — and the
 * deadline is routinely a week or more before the date itself. */
function postByLabel(occasion: OccasionWithRecipient, today: Date): string {
  if (!occasion.dispatchDate) return "Post as soon as you can";
  if (occasion.dispatchDate < today) return "Post today — this one is already late";
  return `Post by ${formatDate(occasion.dispatchDate)}`;
}

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
  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: PLATFORM_TIME_ZONE })
  async runDueReminders(): Promise<ReminderRunResult> {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const deadlineHorizon = new Date(today);
    deadlineHorizon.setUTCDate(deadlineHorizon.getUTCDate() + REMINDER_LEAD_DAYS);

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
        // Still ahead of us — a date that has already gone is the retire
        // sweep's business, not something to nudge anyone about.
        occasionDate: { gte: today },
        // No lower bound on the deadline, on purpose. A card whose posting date
        // has already slipped is the *most* urgent thing a customer can be told
        // about while the date itself is still ahead; bounding this at `today`
        // would silently drop exactly those.
        OR: [
          { dispatchDate: { lte: deadlineHorizon } },
          // The column is nullable and nothing creates a null today, but a
          // dropped dispatch date must not mean "never remind": fall back to
          // the occasion-date window this used to use.
          { dispatchDate: null, occasionDate: { lte: deadlineHorizon } },
        ],
        recipientId: { not: null },
        accountId: { in: eligibleAccounts.map((account) => account.id) },
      },
      include: { recipient: true },
      // Soonest deadline first — the order the customer needs to act in.
      orderBy: [{ dispatchDate: "asc" }, { occasionDate: "asc" }],
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
          html: this.renderDigest(account.name, occasions, today),
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
      // `name` and `date` are unchanged so an already-built Brevo template keeps
      // rendering; `postBy` is additive, for the template to adopt when it can.
      birthdays: occasions.map((occasion) => ({
        name: occasion.recipient
          ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
          : "A recipient",
        date: formatDate(occasion.occasionDate),
        postBy: occasion.dispatchDate ? formatDate(occasion.dispatchDate) : null,
      })),
    };
  }

  private renderDigest(
    accountName: string,
    occasions: OccasionWithRecipient[],
    today: Date,
  ): string {
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const rows = occasions
      .map((occasion) => {
        const name = occasion.recipient
          ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
          : "A recipient";
        const date = formatDate(occasion.occasionDate);
        const postBy = postByLabel(occasion, today);
        const overdue = occasion.dispatchDate != null && occasion.dispatchDate < today;
        return `
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border}">
              <span style="font-weight:600;color:${BRAND.ink}">${escapeHtml(name)}</span>
              <br />
              <span style="font-size:13px;color:${overdue ? BRAND.accent : BRAND.muted}">${escapeHtml(
                postBy,
              )}</span>
            </td>
            <td align="right" style="padding:10px 0;border-bottom:1px solid ${BRAND.border};color:${BRAND.muted};white-space:nowrap">
              ${date}
            </td>
          </tr>`;
      })
      .join("");

    const count = occasions.length;
    const bodyHtml = `
      <p style="margin:0 0 16px">
        Hi ${escapeHtml(accountName)}, ${
          count === 1 ? "a card needs" : `${count} cards need`
        } sending soon. The post-by date is what to work to — it is five working
        days before the day itself, and further ahead over bank holidays and
        Christmas.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px">
        ${rows}
      </table>
      <p style="margin:20px 0 0">
        Review each card and send it in a couple of taps — or turn on automatic sending so it just happens.
      </p>`;

    return renderBrandedEmail({
      webAppUrl,
      preheader:
        count === 1
          ? "A birthday is coming up on Kudos Cards"
          : `${count} birthdays are coming up on Kudos Cards`,
      heading: count === 1 ? "An upcoming birthday" : "Upcoming birthdays",
      bodyHtml,
      cta: { url: `${webAppUrl}/calendar`, label: "Review & send" },
      footerNote: "You can turn these reminders off any time in your Kudos billing settings.",
    });
  }
}
