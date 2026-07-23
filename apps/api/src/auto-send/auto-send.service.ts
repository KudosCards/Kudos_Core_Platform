import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { Occasion, Recipient } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { WalletService } from "../wallet/wallet.service";
import { NotificationInboxService } from "../notifications/notification-inbox.service";
import { computeCardPriceMinor, computePostageMinor } from "../billing/billing.constants";
import { runSerializable } from "../common/run-serializable";

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
  ) {}

  /** Runs after the 6am birthday scheduler so newly-scheduled occasions aren't
   * raced, though they still need human approval before they're ever eligible. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
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
        await this.autoSendOne(occasion);
        result.sent += 1;
        await this.notifyAutoSent(occasion);
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
  private async autoSendOne(occasion: OccasionWithRecipient): Promise<void> {
    if (!occasion.recipient) {
      throw new Error("Occasion has no recipient");
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

    await runSerializable(this.prisma, async (tx) => {
      // Status-guarded consume: if a concurrent run or a manual checkout already
      // took this occasion, count is 0 and we bail before creating an order.
      const { count } = await tx.occasion.updateMany({
        where: { id: occasion.id, status: "approved", dispatchOption: "auto_send" },
        data: { status: "queued" },
      });
      if (count === 0) {
        throw new Error("Occasion was already actioned");
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
    });
  }
}
