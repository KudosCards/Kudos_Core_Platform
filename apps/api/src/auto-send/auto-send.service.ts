import { ConflictException, ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import type { Occasion, Recipient } from "@prisma/client";
import { type DesignDocument, applyCardMessage, linkedMessagePageId } from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OpsActivityService } from "../ops-activity/ops-activity.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { WalletService } from "../wallet/wallet.service";
import { NotificationInboxService } from "../notifications/notification-inbox.service";
import { computeCardPriceMinor, computePostageMinor } from "../billing/billing.constants";
import { runSerializable } from "../common/run-serializable";
import { PLATFORM_TIME_ZONE } from "../common/scheduling";
import { resolveAccountEmail } from "../common/account-email";
import type { EnvConfig } from "../config/env.schema";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { BRAND, escapeHtml, renderBrandedEmail } from "../email/email-layout";
import {
  AutoSendSkipError,
  type AutoSendSkipCopy,
  type AutoSendSkipReason,
  autoSendSkipCopy,
  skipReasonOf,
  tellsCustomer,
} from "./auto-send-skip";

/** No human triggers the cron — mirrors the webhook's SYSTEM_ACTOR convention. */
const SYSTEM_ACTOR = "system:auto-send";

export interface AutoSendSkip {
  occasionId: string;
  /** The raw thrown message — for the ops run report and the server log. */
  reason: string;
  /** The stable code the customer copy and the audit trail are keyed on. */
  reasonCode: AutoSendSkipReason;
}

/** One line of the "a card did not go out" email. */
interface SkipRow {
  recipientName: string;
  occasionLabel: string;
  copy: AutoSendSkipCopy;
}

export interface AutoSendResult {
  /** Occasions whose dispatch date has arrived and were considered this run. */
  due: number;
  /** Successfully ordered, paid from the wallet, and queued for fulfilment. */
  sent: number;
  /** Occasions left approved for a human to handle, with why. */
  skipped: AutoSendSkip[];
}

type OccasionWithRecipient = Occasion & {
  recipient: Recipient | null;
  /** The message a standing order chose for this card, picked at approval
   * (ADR 0260). Null for every card a person approved themselves. */
  standingOrderMessage?: { text: string } | null;
};

/** Who the card was for, as a customer would name them. Falls back to the
 * occasion's own title for the one skip where the contact is gone. */
function recipientLabel(occasion: OccasionWithRecipient): string {
  if (occasion.recipient) {
    return `${occasion.recipient.firstName} ${occasion.recipient.lastName}`;
  }
  return occasion.title ?? "a recipient";
}

/**
 * The hands-off half of "approve once, we handle the rest": a daily cron finds
 * every approved `auto_send` occasion whose dispatch date has arrived, creates
 * a one-card order from the recipient's stored address, pays it from the account
 * wallet, and hands it to fulfilment — no human step. A human still approved the
 * card (design + go-ahead); this only automates the ordering, payment, and
 * dispatch timing. See docs/adr/0013-auto-send.md.
 */
@Injectable()
export class AutoSendService {
  private readonly logger = new Logger(AutoSendService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly wallet: WalletService,
    private readonly inbox: NotificationInboxService,
    private readonly opsActivity: OpsActivityService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
  ) {}

  /** Runs after the 6am birthday scheduler so newly-scheduled occasions aren't
   * raced, though they still need human approval before they're ever eligible. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM, { timeZone: PLATFORM_TIME_ZONE })
  async runDue(): Promise<AutoSendResult> {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const due = await this.prisma.occasion.findMany({
      where: {
        status: "approved",
        dispatchOption: "auto_send",
        dispatchDate: { lte: today },
      },
      include: { recipient: true, standingOrderMessage: { select: { text: true } } },
    });

    const result: AutoSendResult = { due: due.length, sent: 0, skipped: [] };
    // Cards the customer has not been told about yet, grouped so one bad morning
    // is one email rather than one email per card.
    const toEmail = new Map<string, SkipRow[]>();

    // Sequential, not Promise.all: each card is a wallet debit, and running them
    // one at a time keeps the balance arithmetic easy to reason about and avoids
    // a burst of Serializable retries all contending on the same account.
    for (const occasion of due) {
      try {
        const batchOrderId = await this.autoSendOne(occasion);
        result.sent += 1;
        await this.notifyAutoSent(occasion);
        // An auto-send is a real paid order, and it never goes near Stripe's
        // webhook — so Kudos HQ would otherwise never hear about it.
        await this.opsActivity.orderPaid(batchOrderId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        const reasonCode = skipReasonOf(error);
        result.skipped.push({ occasionId: occasion.id, reason, reasonCode });
        await this.audit.record({
          accountId: occasion.accountId,
          actorUserId: SYSTEM_ACTOR,
          action: "auto_send_skipped",
          targetType: "Occasion",
          targetId: occasion.id,
          metadata: { reason, reasonCode },
        });
        // An unrecognised failure is the one nobody can act on from the copy
        // alone — the customer is told we are looking into it, so somebody at
        // Kudos HQ has to actually be told too.
        if (reasonCode === "unknown") {
          await this.opsActivity.autoSendFailedUnexpectedly(
            occasion.accountId,
            occasion.id,
            reason,
          );
        }
        const row = await this.recordSkip(occasion, reasonCode);
        if (row) {
          const rows = toEmail.get(occasion.accountId) ?? [];
          rows.push(row);
          toEmail.set(occasion.accountId, rows);
        }
      }
    }

    // After the loop, and best-effort per account: a send that throws must not
    // strand the accounts behind it in the map.
    for (const [accountId, rows] of toEmail) {
      await this.emailSkips(accountId, rows);
    }

    this.logger.log(
      `Auto-send: ${result.sent}/${result.due} sent, ${result.skipped.length} skipped`,
    );
    return result;
  }

  /** Tell the team a card went out on its own — an auto-send is an action no
   * human triggered, so it's exactly the kind of "it happened" event the inbox
   * exists for. Best-effort and idempotent on the occasion id, so it never
   * turns a successful send into a run failure. See docs/adr/0034. */
  private async notifyAutoSent(occasion: OccasionWithRecipient): Promise<void> {
    try {
      const name = recipientLabel(occasion);
      const label = occasion.title ?? occasion.type;
      await this.inbox.notifyAccount(occasion.accountId, {
        kind: "auto_send",
        title: `A card was sent to ${name}`,
        body: `Their ${label} card was ordered and posted automatically.`,
        href: "/orders",
        entityType: "Occasion",
        entityId: occasion.id,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Auto-send notification for occasion ${occasion.id} failed: ${reason}`);
    }
  }

  /**
   * Tell the account a card they had already approved did not go out.
   *
   * This is the half of auto-send that was missing. `runDue` audited every skip
   * and told nobody, which is survivable while a customer is still watching
   * each card and indefensible the moment we ask them to stop watching. A
   * birthday that silently did not happen is the worst outcome this product
   * has.
   *
   * Returns the row to put in the email when this is the first time the account
   * has heard about this problem on this card, and null when it is not — so the
   * daily retry does not become a daily email. The inbox dedupe is the only
   * ledger of "already told them": if writing it fails we send no email either,
   * because an email with no record of having been sent is how a customer gets
   * the same one every morning for a fortnight.
   */
  private async recordSkip(
    occasion: OccasionWithRecipient,
    reason: AutoSendSkipReason,
  ): Promise<SkipRow | null> {
    if (!tellsCustomer(reason)) {
      return null;
    }
    const copy = autoSendSkipCopy(reason, occasion.recipientId);
    const recipientName = recipientLabel(occasion);
    const occasionLabel = occasion.title ?? occasion.type;
    try {
      const recorded = await this.inbox.notifyAccount(occasion.accountId, {
        kind: "auto_send_failed",
        title: `A card to ${recipientName} did not go out`,
        body: `${copy.why} ${copy.fix}`,
        href: copy.href,
        entityType: "Occasion",
        // Keyed on the occasion AND the reason. Keyed on the occasion alone, a
        // customer who topped up their wallet and still had no address for the
        // contact would never hear the second half. Keyed on neither, they would
        // hear the first half every morning until they fixed it.
        entityId: `${occasion.id}:${reason}`,
      });
      return recorded ? { recipientName, occasionLabel, copy } : null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Auto-send skip notice for occasion ${occasion.id} failed: ${detail}`);
      return null;
    }
  }

  /**
   * The "a card did not go out" email — one per account per run, covering only
   * what was newly recorded above.
   *
   * Deliberately not gated on `reminderEmailsEnabled`: that switch turns off
   * nudges about cards the customer has not sent yet, and this is not a nudge.
   * It is the product reporting that something it was trusted to do did not
   * happen. Best-effort throughout — a mail failure must never fail the run.
   */
  private async emailSkips(accountId: string, rows: SkipRow[]): Promise<void> {
    if (rows.length === 0) return;
    try {
      const to = await resolveAccountEmail(this.prisma, accountId);
      if (!to) return;
      const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
      const count = rows.length;
      await this.email.sendTransactional({
        to,
        subject:
          count === 1 ? "A card did not go out today" : `${count} cards did not go out today`,
        // Template params, for reference when building the Brevo template:
        //   {{ params.count }}  — how many cards
        //   {{ params.cards }}  — [{ name, occasion, why, fix, url }] to loop over
        templateId: this.config.get("BREVO_AUTO_SEND_SKIPPED_TEMPLATE_ID", { infer: true }),
        params: {
          count,
          cards: rows.map((row) => ({
            name: row.recipientName,
            occasion: row.occasionLabel,
            why: row.copy.why,
            fix: row.copy.fix,
            url: `${webAppUrl}${row.copy.href}`,
          })),
        },
        html: this.renderSkipDigest(webAppUrl, rows),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Auto-send skip email to account ${accountId} failed: ${detail}`);
    }
  }

  private renderSkipDigest(webAppUrl: string, rows: SkipRow[]): string {
    const count = rows.length;
    const items = rows
      .map(
        (row) => `
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid ${BRAND.border}">
              <span style="font-weight:600;color:${BRAND.ink}">${escapeHtml(row.recipientName)}</span>
              <span style="color:${BRAND.muted}"> — ${escapeHtml(row.occasionLabel)}</span>
              <br />
              <span style="font-size:13px;color:${BRAND.muted}">${escapeHtml(row.copy.why)}</span>
              <br />
              <a href="${escapeHtml(`${webAppUrl}${row.copy.href}`)}" style="font-size:13px;color:${BRAND.accent};text-decoration:underline">${escapeHtml(
                row.copy.fix,
              )}</a>
            </td>
          </tr>`,
      )
      .join("");

    // One card ⇒ send them straight to the one thing that fixes it. Several ⇒
    // the calendar, because there is no single button for four different
    // problems and pretending otherwise wastes the click.
    const only = count === 1 ? rows[0] : undefined;
    const cta = only
      ? { url: `${webAppUrl}${only.copy.href}`, label: only.copy.cta }
      : { url: `${webAppUrl}/calendar`, label: "Review your cards" };

    const bodyHtml = `
      <p style="margin:0 0 16px">
        ${
          count === 1
            ? "A card we were due to send automatically today did not go out."
            : `${count} cards we were due to send automatically today did not go out.`
        }
        ${count === 1 ? "It is" : "They are"} still approved and we will try again on the next
        run, so sorting the below is all that is needed.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px">
        ${items}
      </table>`;

    return renderBrandedEmail({
      webAppUrl,
      preheader:
        count === 1
          ? "A card did not go out — here is why, and what fixes it"
          : `${count} cards did not go out — here is why, and what fixes them`,
      heading: count === 1 ? "A card did not go out" : "Some cards did not go out",
      bodyHtml,
      cta,
    });
  }

  /**
   * Orders, pays, and queues one occasion atomically. Everything — consuming the
   * occasion, creating the order, debiting the wallet, and settling fulfilment —
   * happens in one Serializable transaction, so insufficient funds (or any other
   * failure) rolls the whole thing back and leaves the occasion approved for a
   * retry next run or manual handling. Throws on any skip condition; runDue turns
   * the throw into an audited skip.
   */
  private async autoSendOne(occasion: OccasionWithRecipient): Promise<string> {
    if (!occasion.recipient) {
      throw new AutoSendSkipError("no_recipient", "Occasion has no recipient");
    }
    // Archiving is the only way to stop sending to somebody — there is no
    // delete — and a card approved before the archive was still being printed,
    // paid for out of the wallet and posted to them. Checked here rather than
    // filtered out of the due query on purpose: a card that does not go is
    // something the customer hears about (ADR 0254), and silence is what that
    // whole phase exists to prevent.
    if (occasion.recipient.status === "archived") {
      throw new AutoSendSkipError("recipient_archived", "Contact is archived");
    }
    // A card to this contact was returned and the address isn't re-verified yet —
    // hold their automatic sends until the return case is resolved, so we don't
    // fire another card at a known-bad address. See docs/adr/0039-returned-to-sender.md.
    if (occasion.recipient.addressVerificationRequired) {
      throw new AutoSendSkipError(
        "address_verification_required",
        "Contact needs address verification after a returned card",
      );
    }
    if (!occasion.savedDesignId) {
      throw new AutoSendSkipError("no_design", "Occasion has no approved design");
    }
    const { addressLine1, addressCity, addressPostcode } = occasion.recipient;
    if (!addressLine1 || !addressCity || !addressPostcode) {
      throw new AutoSendSkipError("missing_address", "Recipient is missing a postal address");
    }

    // The plan may have been downgraded since approval — re-check the capability
    // before charging.
    const entitlement = await this.entitlements.getForAccount(occasion.accountId);
    if (!entitlement.autoSendEnabled) {
      throw new AutoSendSkipError("plan_not_permitted", "Plan no longer permits auto-send");
    }

    const priceMinor = computeCardPriceMinor(entitlement.cardDiscountPercent);
    const postageMinor = computePostageMinor(occasion.postageClass);
    const totalMinor = priceMinor + postageMinor;
    const recipient = occasion.recipient;
    const savedDesignId = occasion.savedDesignId;

    // Returns the order it created so the caller can report it to Kudos HQ
    // *after* this transaction commits — see OpsActivityService.
    return runSerializable(this.prisma, async (tx) => {
      // Status-guarded consume: if a concurrent run or a manual checkout already
      // took this occasion, count is 0 and we bail before creating an order.
      const { count } = await tx.occasion.updateMany({
        where: { id: occasion.id, status: "approved", dispatchOption: "auto_send" },
        data: { status: "queued" },
      });
      if (count === 0) {
        throw new AutoSendSkipError("already_actioned", "Occasion was already actioned");
      }

      // Resolve the design's linked message page (ADR 0137). The interactive
      // send composers carry the sender's explicit page choice; auto-send has no
      // composer, so it resolves the design's linked page itself here — the one
      // path that legitimately falls back to the design. Re-validated active +
      // owned by this account, because the design document is user-editable JSON
      // and must not bind a card to another account's (or an archived) page.
      // Settlement then honours this verbatim, so an empty choice elsewhere is a
      // real "no page" rather than a silently re-attached design page.
      const design = await tx.savedDesign.findUnique({
        where: { id: savedDesignId },
        select: { document: true },
      });
      if (!design) {
        // The FK guarantees the row, so this is a "cannot happen" — said out
        // loud rather than sending a card with no artwork in it.
        throw new ConflictException(`Design ${savedDesignId} is missing`);
      }
      // The chosen message goes into the card's own copy, never into the saved
      // design: the design is the customer's and is shared by every card made
      // from it. A design with no message slot is left exactly as it is and
      // carries its own words — see ADR 0260 for why that is preferred to
      // refusing to send.
      const document = occasion.standingOrderMessage
        ? applyCardMessage(design.document as DesignDocument, occasion.standingOrderMessage.text)
        : (design.document as DesignDocument);

      const linkedPageId = linkedMessagePageId(design.document as DesignDocument | null);
      let messagePageId: string | null = null;
      if (linkedPageId) {
        const page = await tx.messagePage.findFirst({
          where: { id: linkedPageId, accountId: occasion.accountId, status: "active" },
          select: { id: true },
        });
        messagePageId = page?.id ?? null;
      }

      const order = await tx.batchOrder.create({
        data: {
          accountId: occasion.accountId,
          createdByUserId: SYSTEM_ACTOR,
          status: "draft",
          subtotalMinor: priceMinor,
          postageMinor,
          totalMinor,
        },
      });

      await tx.orderRecipient.create({
        data: {
          batchOrderId: order.id,
          recipientId: recipient.id,
          occasionId: occasion.id,
          savedDesignId,
          // The card's own copy, taken in the same transaction that reads the
          // design — see docs/order-artwork-plan.md.
          documentSnapshot: document,
          messagePageId,
          shippingAddressLine1: addressLine1,
          shippingAddressLine2: recipient.addressLine2,
          shippingAddressCity: addressCity,
          shippingAddressPostcode: addressPostcode,
          shippingAddressCountry: recipient.addressCountry ?? "GB",
          dispatchOption: "auto_send",
          postageClass: occasion.postageClass,
          priceMinor,
          postageMinor,
          status: "approved",
        },
      });

      // Debit the wallet and settle fulfilment in the same transaction; an
      // insufficient balance throws here and rolls back the occasion consume +
      // order creation above.
      try {
        await this.wallet.debitAndSettleOrder(tx, occasion.accountId, order.id);
      } catch (error) {
        // `debitAndSettleOrder` raises ForbiddenException for exactly one thing:
        // a balance that does not cover the order. Everything else it can throw
        // — a vanished order, an order already paid — is a genuine surprise, and
        // must stay unclassified so it reaches Kudos HQ rather than telling the
        // customer to top up a wallet that is already full.
        if (error instanceof ForbiddenException) {
          throw new AutoSendSkipError("insufficient_funds", "Insufficient wallet balance");
        }
        throw error;
      }

      await this.audit.record(
        {
          accountId: occasion.accountId,
          actorUserId: SYSTEM_ACTOR,
          action: "auto_send_succeeded",
          targetType: "BatchOrder",
          targetId: order.id,
          metadata: { occasionId: occasion.id, totalMinor },
        },
        tx,
      );

      return order.id;
    });
  }
}
