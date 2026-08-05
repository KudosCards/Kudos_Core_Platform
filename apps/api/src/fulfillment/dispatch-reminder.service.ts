import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import type { EnvConfig } from "../config/env.schema";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { BRAND, escapeHtml, renderBrandedEmail } from "../email/email-layout";
import { PlatformNotificationService } from "../platform-notifications/platform-notification.service";
import { FulfillmentService, type MustShipCard, type MustShipSummary } from "./fulfillment.service";

/** What one reminder run did — returned for tests + logging. */
export interface DispatchReminderResult {
  adminsEmailed: number;
  overdue: number;
  today: number;
  dueSoon: number;
}

/**
 * The send-by-5 push (ADR 0115): a standing weekday digest to Kudos HQ of the
 * cards that must be posted to keep every order inside its 5-working-day delivery
 * window. Reuses the one must-ship query so the email, the dashboard band and the
 * notification centre always agree. Suppressed when there's nothing to post.
 */
@Injectable()
export class DispatchReminderService {
  private readonly logger = new Logger(DispatchReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly fulfillment: FulfillmentService,
    private readonly platformNotifications: PlatformNotificationService,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
  ) {}

  /**
   * Weekday mornings, after the auto-send cron (7am) so anything auto-posted is
   * already gone. Weekends are skipped — Kudos HQ doesn't print/post then, and
   * Monday's run carries the weekend's cards. See ADR 0115.
   */
  @Cron("30 7 * * 1-5")
  async runDispatchReminder(): Promise<DispatchReminderResult> {
    const summary = await this.fulfillment.mustShip();
    if (summary.total === 0) {
      // Nothing to post — a clean send-by-5 board, so no email. Suppress-when-empty
      // keeps the digest a signal, not daily noise.
      return { adminsEmailed: 0, overdue: 0, today: 0, dueSoon: 0 };
    }

    // The in-app notification centre (ADR 0116) — written regardless of email, so
    // every operator sees it in the ops bell even without an email set. One entry
    // per day (entityId = today) keeps a re-fired cron from duplicating.
    try {
      const isoToday = new Date().toISOString().slice(0, 10);
      await this.platformNotifications.notifyAllAdmins({
        kind: "dispatch_reminder",
        title: this.notificationTitle(summary),
        body: this.notificationBody(summary),
        href: "/fulfillment",
        entityType: "dispatch_reminder",
        entityId: isoToday,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Dispatch reminder in-app notification failed: ${reason}`);
    }

    const admins = await this.prisma.platformAdmin.findMany({
      where: { email: { not: null } },
      select: { email: true },
    });
    const emails = [
      ...new Set(
        admins
          .map((a) => a.email?.trim().toLowerCase())
          .filter((e): e is string => !!e && e.length > 0),
      ),
    ];
    if (emails.length === 0) {
      this.logger.warn(
        `Dispatch reminder: ${summary.total} card(s) to post but no platform admin has an email set`,
      );
      return {
        adminsEmailed: 0,
        overdue: summary.overdue,
        today: summary.today,
        dueSoon: summary.dueSoon,
      };
    }

    const subject = this.buildSubject(summary);
    const html = this.render(summary);
    let adminsEmailed = 0;
    for (const to of emails) {
      // Per-recipient try/catch: one admin's send failing must not skip the rest.
      try {
        await this.email.sendTransactional({ to, subject, html });
        adminsEmailed += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Dispatch reminder to ${to} failed: ${reason}`);
      }
    }

    this.logger.log(
      `Dispatch reminder: ${summary.total} to post (${summary.overdue} overdue) → ${adminsEmailed} admin(s)`,
    );
    return {
      adminsEmailed,
      overdue: summary.overdue,
      today: summary.today,
      dueSoon: summary.dueSoon,
    };
  }

  /** Concise in-app notification title — overdue-led. */
  private notificationTitle(s: MustShipSummary): string {
    if (s.overdue > 0) {
      return `${s.overdue} card${s.overdue === 1 ? "" : "s"} overdue to post`;
    }
    return `${s.total} card${s.total === 1 ? "" : "s"} to post today`;
  }

  private notificationBody(s: MustShipSummary): string {
    return `${s.overdue} overdue · ${s.today} due today · ${s.dueSoon} due within 5 working days`;
  }

  /** Lead with overdue when there is any — that's the line that must not be missed. */
  private buildSubject(s: MustShipSummary): string {
    if (s.overdue > 0) {
      return `⚠️ ${s.overdue} card${s.overdue === 1 ? "" : "s"} overdue to post — ${s.total} to ship`;
    }
    return `🖨️ ${s.total} card${s.total === 1 ? "" : "s"} to post today`;
  }

  private render(s: MustShipSummary): string {
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const overdue = s.cards.filter((c) => c.workingDaysUntilDue < 0);
    const today = s.cards.filter((c) => c.workingDaysUntilDue === 0);
    const soon = s.cards.filter((c) => c.workingDaysUntilDue > 0);

    const bodyHtml = `
      <p style="margin:0 0 8px">
        <strong>${s.total}</strong> card${s.total === 1 ? "" : "s"} need posting to stay inside the 5-working-day delivery window.
      </p>
      <p style="margin:0 0 4px;color:${BRAND.muted};font-size:14px">
        ${s.overdue} overdue · ${s.today} due today · ${s.dueSoon} due within 5 working days
      </p>
      ${this.section("Overdue — post now", "#b91c1c", s.overdue, overdue)}
      ${this.section("Post today", "#b45309", s.today, today)}
      ${this.section("Post within 5 working days", BRAND.ink, s.dueSoon, soon)}`;

    return renderBrandedEmail({
      webAppUrl,
      preheader: `${s.total} card${s.total === 1 ? "" : "s"} to post — ${s.overdue} overdue`,
      heading: "Cards to post",
      bodyHtml,
      cta: { url: `${webAppUrl}/fulfillment`, label: "Open the fulfilment queue" },
      footerNote: "You're receiving this as a Kudos HQ platform admin.",
    });
  }

  /** One urgency band: its heading + the cards we hold for it, with an "…and N
   * more" line when the band's total exceeds the (bounded) sample. */
  private section(label: string, colour: string, count: number, cards: MustShipCard[]): string {
    if (count === 0) return "";
    const rows = cards.map((c) => this.cardRow(c)).join("");
    const more =
      count > cards.length
        ? `<tr><td colspan="2" style="padding:6px 0;color:${BRAND.muted};font-size:13px">…and ${
            count - cards.length
          } more</td></tr>`
        : "";
    return `
      <p style="margin:20px 0 6px;font-weight:700;color:${colour}">${escapeHtml(label)} (${count})</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}${more}</table>`;
  }

  private cardRow(c: MustShipCard): string {
    const due = c.dueDate.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    const late = c.workingDaysUntilDue < 0 ? ` · ${Math.abs(c.workingDaysUntilDue)}wd late` : "";
    return `
      <tr>
        <td style="padding:6px 0;border-bottom:1px solid ${BRAND.border}">
          <span style="font-weight:600;color:${BRAND.ink}">${escapeHtml(c.recipientName)}</span>
          <span style="color:${BRAND.muted}"> — ORD-${c.orderNumber} · ${escapeHtml(c.city)}</span>
        </td>
        <td align="right" style="padding:6px 0;border-bottom:1px solid ${BRAND.border};color:${BRAND.muted};white-space:nowrap">
          ${due}${late}
        </td>
      </tr>`;
  }
}
