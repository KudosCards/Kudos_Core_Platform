import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { londonDay, londonHour, type DispatchReminderConfig } from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import type { EnvConfig } from "../config/env.schema";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { BRAND, escapeHtml, renderBrandedEmail } from "../email/email-layout";
import { PlatformNotificationService } from "../platform-notifications/platform-notification.service";
import { DispatchConfigService } from "../dispatch/dispatch-config.service";
import { FulfillmentService, type MustShipCard, type MustShipSummary } from "./fulfillment.service";
import { PLATFORM_TIME_ZONE } from "../common/scheduling";

/** How this run was reached. */
export interface DispatchReminderRunOptions {
  /**
   * Whether another tick will attempt today's digest if this one declines.
   * True for every tick of the send window but the last; false for a direct
   * run, which has no successor.
   */
  retryFollows?: boolean;
}

/** What one reminder run did — returned for tests + logging. */
export interface DispatchReminderResult {
  adminsEmailed: number;
  overdue: number;
  today: number;
  dueSoon: number;
  /** Cards overdue by ≥ the escalation threshold. */
  critical: number;
  /** Whether a super-admin escalation was sent this run. */
  escalated: boolean;
}

/**
 * The send-by-5 push (ADR 0115): a standing weekday digest to Kudos HQ of the
 * cards that must be posted to keep every order inside its send-by window. Reuses
 * the one must-ship query so the email, the dashboard band and the notification
 * centre always agree. Suppressed when there's nothing to post. Its cadence,
 * send hour, window and escalation are runtime-configurable (ADR 0117).
 */
@Injectable()
export class DispatchReminderService {
  private readonly logger = new Logger(DispatchReminderService.name);

  constructor(
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly fulfillment: FulfillmentService,
    private readonly platformNotifications: PlatformNotificationService,
    private readonly dispatchConfig: DispatchConfigService,
    private readonly prisma: PrismaService,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
  ) {}

  /**
   * Fires hourly on weekdays and proceeds from the configured send hour until
   * the same-day cut-off, so the send time (and whether it runs at all) is
   * editable with no redeploy. Weekends are skipped — Kudos HQ doesn't
   * print/post then, and Monday's run carries the weekend's cards. See ADR
   * 0115/0117.
   *
   * A window rather than an instant, because an exact-hour match threw away
   * every tick but one: if the API was restarting when that tick landed — a
   * deploy spanning 07:00 — the whole day's digest was lost, and the failure is
   * silence on the alert whose only job is to arrive. See ADR 0216.
   */
  @Cron("0 * * * 1-5", { timeZone: PLATFORM_TIME_ZONE })
  async scheduledReminder(): Promise<void> {
    const config = await this.dispatchConfig.getReminderConfig();
    if (!config.enabled) return;
    const hour = londonHour(new Date());
    const { first, last } = this.sendWindow(config);
    if (hour < first || hour > last) return;
    // Whether this tick has a successor to hand the day to. Only matters when
    // the run loses its dedupe guard — see `runDispatchReminder`.
    await this.runDispatchReminder(config, { retryFollows: hour < last });
  }

  /**
   * The inclusive range of London hours in which an hourly tick may attempt the
   * day's digest.
   *
   * London, not UTC. The hour an operator sets is the hour they mean; judging
   * it against the server's UTC clock made a "07:00" reminder arrive at 08:00
   * for the seven months of BST — while the same-day cut-off on the same
   * settings panel was already UK-local (ADR 0160). One panel, one clock.
   *
   * The window opens at the send hour and closes at the same-day cut-off, the
   * hour after which a card ordered today no longer posts today: past it a
   * digest is asking for something that can no longer happen. Only the first
   * tick inside the window sends anything — `runDispatchReminder` keys the
   * notification-centre entry on the London day and stops there if it already
   * exists (ADR 0211), so a window costs at most the same one digest an instant
   * did *as long as that entry can be written*. When it can't, the tick defers
   * to its successor rather than assuming it went first; the last tick has no
   * successor, which is why the caller says whether one follows. See ADR 0225.
   *
   * Both hours are independently 0-23 on the settings panel, so a send hour
   * *after* the cut-off is a config an operator can save. `Math.max` collapses
   * the window to the send hour alone rather than to nothing, which is the
   * behaviour that config had before there was a window at all.
   */
  private sendWindow(config: DispatchReminderConfig): { first: number; last: number } {
    return {
      first: config.sendHourLondon,
      last: Math.max(config.sendHourLondon, config.sameDayCutoffHour),
    };
  }

  /**
   * The reminder itself — runnable directly (tests, an on-demand trigger) without
   * the cron's enabled/hour gate. Emails all operators the digest, writes the
   * in-app entry, and escalates critically-overdue cards to super admins.
   *
   * `options.retryFollows` defaults to false: a direct run is its own last
   * chance, so it behaves as it always has.
   */
  async runDispatchReminder(
    config?: DispatchReminderConfig,
    options: DispatchReminderRunOptions = {},
  ): Promise<DispatchReminderResult> {
    const cfg = config ?? (await this.dispatchConfig.getReminderConfig());
    const summary = await this.fulfillment.mustShip();
    const base: DispatchReminderResult = {
      adminsEmailed: 0,
      overdue: summary.overdue,
      today: summary.today,
      dueSoon: summary.dueSoon,
      critical: 0,
      escalated: false,
    };
    if (summary.total === 0) {
      // Nothing to post — a clean board, so no email/notification. Suppress-when-
      // empty keeps the digest a signal, not daily noise.
      return { ...base, overdue: 0, today: 0, dueSoon: 0 };
    }

    // The in-app notification centre entry (ADR 0116), written regardless of
    // email. The `created` flag is a "first run wins" guard: if another API
    // instance already recorded today's entry, it also already emailed, so we
    // stop here to avoid duplicate sends.
    //
    // The day has to be London's, not UTC's — same reason as the send hour
    // above. Through BST a London day begins at 23:00 the previous day in UTC,
    // so a UTC key names the wrong day for seven months, and any two runs that
    // straddle 23:00 UTC are told apart by the calendar everyone in the UK is
    // reading while sharing one key here. When that happens the second run
    // looks like a repeat: `notifyAllAdmins` answers false and the digest goes
    // to nobody. See ADR 0211.
    const today = londonDay(new Date());
    let created = true;
    let guardLost = false;
    try {
      created = await this.platformNotifications.notifyAllAdmins({
        kind: "dispatch_reminder",
        title: this.notificationTitle(summary),
        body: this.notificationBody(summary, cfg),
        href: "/fulfillment",
        entityType: "dispatch_reminder",
        entityId: today,
      });
    } catch (error) {
      // `created` keeps its initialised `true`, so without the flag below this
      // run would go on believing it went first.
      guardLost = true;
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Dispatch reminder in-app notification failed: ${reason}`);
    }
    if (!created) {
      return base;
    }
    if (guardLost && options.retryFollows) {
      // The tick that cannot record itself cannot tell whether an earlier tick
      // already emailed, so it hands the day to the next one. That is only safe
      // because there is a next one: hourly ticks from the send hour to the
      // cut-off (ADR 0216). Sending anyway was the right call when the gate kept
      // exactly one tick a day and a lost guard cost nothing; against a nine-hour
      // window a durable failure costs nine identical digests, which is how an
      // alert stops being read. The last tick of the window is passed
      // `retryFollows: false` and still sends, because silence is the one
      // outcome this alert must not have. See ADR 0225.
      this.logger.warn(
        "Dispatch reminder: dedupe guard unavailable, deferring the digest to the next tick",
      );
      return base;
    }

    // Escalation (ADR 0117): cards overdue by ≥ the threshold get a louder alert
    // to super admins. 0 disables it. Worked out *before* the digest goes out,
    // because whoever is getting the escalation must not also get the digest —
    // they used to get both, with byte-identical bodies and only the subject
    // differing, which reads as the system sending everything twice.
    const critical =
      cfg.escalateAfterWorkingDays > 0
        ? summary.cards.filter((c) => c.workingDaysUntilDue <= -cfg.escalateAfterWorkingDays).length
        : 0;
    const escalationEmails = critical > 0 ? await this.adminEmails("super_admin") : [];
    const escalationsSent =
      critical > 0 ? await this.escalate(summary, critical, cfg, today, escalationEmails) : 0;

    const allEmails = await this.adminEmails();
    if (allEmails.length === 0) {
      this.logger.warn("Dispatch reminder: cards to post but no platform admin has an email set");
    }
    const escalated = new Set(escalationEmails);
    const digestEmails = allEmails.filter((email) => !escalated.has(email));
    const digestsSent = await this.emailDigest(
      digestEmails,
      this.buildSubject(summary),
      this.render(summary, cfg),
    );

    // One address, one email — so this is the count of people told, not of
    // messages sent.
    const adminsEmailed = digestsSent + escalationsSent;
    this.logger.log(
      `Dispatch reminder: ${summary.total} to post (${summary.overdue} overdue, ${critical} critical) → ${digestsSent} digest(s) + ${escalationsSent} escalation(s)`,
    );
    return { ...base, adminsEmailed, critical, escalated: escalationsSent > 0 };
  }

  /** Distinct operator emails (lower-cased), optionally restricted to a role. */
  private async adminEmails(role?: string): Promise<string[]> {
    const admins = await this.prisma.platformAdmin.findMany({
      where: { email: { not: null }, ...(role ? { role } : {}) },
      select: { email: true },
    });
    return [
      ...new Set(
        admins
          .map((a) => a.email?.trim().toLowerCase())
          .filter((e): e is string => !!e && e.length > 0),
      ),
    ];
  }

  /** Send one email to each address, isolating per-recipient failures. Returns
   * how many were emailed. An empty list is not an error — the caller may have
   * deliberately excluded everyone (they're getting the escalation instead) and
   * warns for itself when nobody has an email at all. */
  private async emailDigest(emails: string[], subject: string, html: string): Promise<number> {
    let sent = 0;
    for (const to of emails) {
      try {
        await this.email.sendTransactional({ to, subject, html });
        sent += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Dispatch reminder to ${to} failed: ${reason}`);
      }
    }
    return sent;
  }

  /**
   * Escalate critically-overdue cards to super admins — an in-app entry plus a
   * genuinely louder email, both restricted to the super_admin role.
   * Best-effort. Returns how many super admins were emailed.
   *
   * `emails` is passed in rather than looked up here so the caller can exclude
   * these same people from the ordinary digest: one person, one email.
   */
  private async escalate(
    summary: MustShipSummary,
    critical: number,
    cfg: DispatchReminderConfig,
    today: string,
    emails: string[],
  ): Promise<number> {
    try {
      await this.platformNotifications.notifyAllAdmins(
        {
          kind: "dispatch_escalation",
          title: `🚨 ${critical} card${critical === 1 ? "" : "s"} critically overdue`,
          body: `Overdue by ${cfg.escalateAfterWorkingDays}+ working days — needs attention now.`,
          href: "/fulfillment",
          entityType: "dispatch_escalation",
          entityId: today,
        },
        { role: "super_admin" },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Dispatch escalation notification failed: ${reason}`);
    }
    const subject = `🚨 ${critical} card${critical === 1 ? "" : "s"} critically overdue to post`;
    // Same card list — a super admin still wants the whole board — but led by
    // the critical banner, so the two emails are told apart at a glance.
    return this.emailDigest(emails, subject, this.render(summary, cfg, critical));
  }

  /** Concise in-app notification title — overdue-led. */
  private notificationTitle(s: MustShipSummary): string {
    if (s.overdue > 0) {
      return `${s.overdue} card${s.overdue === 1 ? "" : "s"} overdue to post`;
    }
    return `${s.total} card${s.total === 1 ? "" : "s"} to post today`;
  }

  private notificationBody(s: MustShipSummary, cfg: DispatchReminderConfig): string {
    return `${s.overdue} overdue · ${s.today} due today · ${s.dueSoon} due within ${cfg.leadWorkingDays} working days`;
  }

  /** Lead with overdue when there is any — that's the line that must not be missed. */
  private buildSubject(s: MustShipSummary): string {
    if (s.overdue > 0) {
      return `⚠️ ${s.overdue} card${s.overdue === 1 ? "" : "s"} overdue to post — ${s.total} to ship`;
    }
    return `🖨️ ${s.total} card${s.total === 1 ? "" : "s"} to post today`;
  }

  /**
   * The email body. `critical > 0` renders the **escalation** version: same card
   * list — a super admin still wants the whole board — but led by a banner and
   * a different heading, so it is obviously not a second copy of the digest.
   *
   * Before this took a `critical` argument, the escalation reused the digest's
   * body verbatim: two emails, same content, only the subject differing.
   */
  private render(s: MustShipSummary, cfg: DispatchReminderConfig, critical = 0): string {
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const overdue = s.cards.filter((c) => c.workingDaysUntilDue < 0);
    const today = s.cards.filter((c) => c.workingDaysUntilDue === 0);
    const soon = s.cards.filter((c) => c.workingDaysUntilDue > 0);
    const window = `${cfg.leadWorkingDays} working days`;

    const banner =
      critical > 0
        ? `<p style="margin:0 0 16px;padding:12px 14px;border-radius:8px;background:#fee2e2;border:1px solid #fca5a5;color:#b91c1c;font-weight:700;font-size:15px">
             ${critical} card${critical === 1 ? " is" : "s are"} overdue by ${cfg.escalateAfterWorkingDays}+ working days. Post ${critical === 1 ? "it" : "them"} today.
           </p>`
        : "";

    const bodyHtml = `
      ${banner}
      <p style="margin:0 0 8px">
        <strong>${s.total}</strong> card${s.total === 1 ? "" : "s"} need posting to stay inside the ${window} delivery window.
      </p>
      <p style="margin:0 0 4px;color:${BRAND.muted};font-size:14px">
        ${s.overdue} overdue · ${s.today} due today · ${s.dueSoon} due within ${window}
      </p>
      ${this.section("Overdue — post now", "#b91c1c", s.overdue, overdue)}
      ${this.section("Post today", "#b45309", s.today, today)}
      ${this.section(`Post within ${window}`, BRAND.ink, s.dueSoon, soon)}`;

    return renderBrandedEmail({
      webAppUrl,
      preheader:
        critical > 0
          ? `${critical} card${critical === 1 ? "" : "s"} critically overdue — post today`
          : `${s.total} card${s.total === 1 ? "" : "s"} to post — ${s.overdue} overdue`,
      heading:
        critical > 0
          ? `${critical} card${critical === 1 ? "" : "s"} critically overdue`
          : "Cards to post",
      bodyHtml,
      cta: { url: `${webAppUrl}/fulfillment`, label: "Open the fulfilment queue" },
      footerNote:
        critical > 0
          ? "You're receiving this as a Kudos HQ super admin — operators got the standard digest."
          : "You're receiving this as a Kudos HQ platform admin.",
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
