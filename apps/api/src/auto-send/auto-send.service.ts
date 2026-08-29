import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { Occasion, Recipient } from "@prisma/client";
import { type DesignDocument, linkedMessagePageId } from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OpsActivityService } from "../ops-activity/ops-activity.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { WalletService } from "../wallet/wallet.service";
import { NotificationInboxService } from "../notifications/notification-inbox.service";
import { computeCardPriceMinor, computePostageMinor } from "../billing/billing.constants";
import { runSerializable } from "../common/run-serializable";
import { PLATFORM_TIME_ZONE } from "../common/scheduling";

/** No human triggers the cron — mirrors the webhook's SYSTEM_ACTOR convention. */
const SYSTEM_ACTOR = "system:auto-send";

export interface AutoSendSkip {
  occasionId: string;
  reason: string;
}

export interface AutoSendResult {
  /** Occasions whose dispatch date has arrived and were considered this run. */
  due: number;
  /** Successfully ordered, paid from the wallet, and queued for fulfilment. */
  sent: number;
  /** Occasions left approved for a human to handle, with why. */
  skipped: AutoSendSkip[];
}

type OccasionWithRecipient = Occasion & { recipient: Recipient | null };

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
      include: { recipient: true },
    });

    const result: AutoSendResult = { due: due.length, sent: 0, skipped: [] };

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
        result.skipped.push({ occasionId: occasion.id, reason });
        await this.audit.record({
          accountId: occasion.accountId,
          actorUserId: SYSTEM_ACTOR,
          action: "auto_send_skipped",
          targetType: "Occasion",
          targetId: occasion.id,
          metadata: { reason },
        });
      }
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
      const name = occasion.recipient
        ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
        : (occasion.title ?? "a recipient");
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
   * Orders, pays, and queues one occasion atomically. Everything — consuming the
   * occasion, creating the order, debiting the wallet, and settling fulfilment —
   * happens in one Serializable transaction, so insufficient funds (or any other
   * failure) rolls the whole thing back and leaves the occasion approved for a
   * retry next run or manual handling. Throws on any skip condition; runDue turns
   * the throw into an audited skip.
   */
  private async autoSendOne(occasion: OccasionWithRecipient): Promise<string> {
    if (!occasion.recipient) {
      throw new Error("Occasion has no recipient");
    }
    // A card to this contact was returned and the address isn't re-verified yet —
    // hold their automatic sends until the return case is resolved, so we don't
    // fire another card at a known-bad address. See docs/adr/0039-returned-to-sender.md.
    if (occasion.recipient.addressVerificationRequired) {
      throw new Error("Contact needs address verification after a returned card");
    }
    if (!occasion.savedDesignId) {
      throw new Error("Occasion has no approved design");
    }
    const { addressLine1, addressCity, addressPostcode } = occasion.recipient;
    if (!addressLine1 || !addressCity || !addressPostcode) {
      throw new Error("Recipient is missing a postal address");
    }

    // The plan may have been downgraded since approval — re-check the capability
    // before charging.
    const entitlement = await this.entitlements.getForAccount(occasion.accountId);
    if (!entitlement.autoSendEnabled) {
      throw new Error("Plan no longer permits auto-send");
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
        throw new Error("Occasion was already actioned");
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
      const linkedPageId = linkedMessagePageId(design?.document as DesignDocument | null);
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
      await this.wallet.debitAndSettleOrder(tx, occasion.accountId, order.id);

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
