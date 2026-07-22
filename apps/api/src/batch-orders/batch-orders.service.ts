import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { AuditService } from "../audit/audit.service";
import type { EnvConfig } from "../config/env.schema";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";
import type { CheckoutResult } from "../common/checkout-result";
import { STRIPE_CLIENT } from "../billing/stripe-client.provider";
import { computeCardPriceMinor, computePostageMinor } from "../billing/billing.constants";
import { MessagesService } from "../messages/messages.service";
import { RecipientsService } from "../recipients/recipients.service";
import { computeDispatchDate } from "../occasions/occasion-scheduling.constants";
import type { CreateBatchOrderDto } from "./dto/create-batch-order.dto";
import type { ListBatchOrdersQueryDto } from "./dto/list-batch-orders-query.dto";
import type { QuickSendDto } from "./dto/quick-send.dto";

const ORDER_RECIPIENTS_INCLUDE = { orderRecipients: true } as const;

export type BatchOrder = Prisma.BatchOrderGetPayload<{ include: typeof ORDER_RECIPIENTS_INCLUDE }>;

@Injectable()
export class BatchOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly messages: MessagesService,
    private readonly recipients: RecipientsService,
  ) {}

  /**
   * The guided first-order path: from a saved design + a single recipient to a
   * ready-to-pay draft order in one call. It creates the recipient, an
   * `approved` one-off occasion carrying the design, then hands off to the same
   * create() the manual checkout uses — so the money path (pricing, the
   * approved → queued transition, cap checks) is identical, not a parallel copy.
   * The caller then drives the returned draft through the normal
   * /batch-orders/:id/checkout. See docs/adr/0018-guided-first-order.md.
   */
  async quickSend(
    accountId: string,
    actorUserId: string | null,
    dto: QuickSendDto,
  ): Promise<BatchOrder> {
    const savedDesign = await this.prisma.savedDesign.findFirst({
      where: { id: dto.savedDesignId, accountId },
    });
    if (!savedDesign) {
      throw new NotFoundException("Design not found");
    }

    // The recipient this card is for. Reuses the audited, cap-checked create so
    // the guided path can't sidestep the plan's recipient limit.
    const recipient = await this.recipients.create(accountId, actorUserId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      addressLine1: dto.shippingAddressLine1,
      addressLine2: dto.shippingAddressLine2,
      addressCity: dto.shippingAddressCity,
      addressPostcode: dto.shippingAddressPostcode,
    });

    // A one-off occasion, created already `approved` with the design attached —
    // the guided flow is the human decision that the manual approve step
    // represents, so there's nothing left to approve. dispatchOption `asap`
    // means a person checks it out (which is exactly what happens next).
    const occasionDate = new Date();
    const occasion = await this.prisma.occasion.create({
      data: {
        accountId,
        recipientId: recipient.id,
        type: dto.occasionType ?? "bespoke_campaign",
        source: "one_off_campaign",
        occasionDate,
        dispatchDate: computeDispatchDate(occasionDate),
        status: "approved",
        savedDesignId: savedDesign.id,
        dispatchOption: "asap",
        postageClass: dto.postageClass,
      },
    });

    return this.create(accountId, actorUserId, {
      lines: [
        {
          occasionId: occasion.id,
          shippingAddressLine1: dto.shippingAddressLine1,
          shippingAddressLine2: dto.shippingAddressLine2,
          shippingAddressCity: dto.shippingAddressCity,
          shippingAddressPostcode: dto.shippingAddressPostcode,
          dispatchOption: "asap",
          postageClass: dto.postageClass,
        },
      ],
    });
  }

  /**
   * The post-payment fulfillment step, shared by every way an order gets paid
   * (Stripe webhook and wallet debit): move the order's approved recipients to
   * `queued`, create a `FulfillmentJob` per card, and mint each card's QR
   * message page. Idempotent (status-guarded + skipDuplicates) so a redelivered
   * webhook or a retried wallet transaction never double-fulfils. Runs inside
   * the caller's transaction — the caller owns the BatchOrder status transition.
   */
  async settleFulfillment(tx: Prisma.TransactionClient, batchOrderId: string): Promise<void> {
    const orderRecipients = await tx.orderRecipient.findMany({
      where: { batchOrderId, status: "approved" },
    });
    await tx.orderRecipient.updateMany({
      where: { batchOrderId, status: "approved" },
      data: { status: "queued" },
    });
    await tx.fulfillmentJob.createMany({
      data: orderRecipients.map((recipient) => ({
        orderRecipientId: recipient.id,
        status: "pending" as const,
      })),
      skipDuplicates: true,
    });
    await this.messages.createForOrderRecipients(
      tx,
      orderRecipients.map((recipient) => recipient.id),
    );
  }

  async create(
    accountId: string,
    actorUserId: string | null,
    dto: CreateBatchOrderDto,
  ): Promise<BatchOrder> {
    const occasionIds = dto.lines.map((line) => line.occasionId);
    const uniqueOccasionIds = new Set(occasionIds);
    if (uniqueOccasionIds.size !== occasionIds.length) {
      throw new BadRequestException("Each occasion can only appear once per batch order");
    }

    const entitlement = await this.entitlements.getForAccount(accountId);
    if (dto.lines.length > entitlement.batchOrderMaxSize) {
      throw new ForbiddenException(
        `This plan allows up to ${entitlement.batchOrderMaxSize} cards per batch order`,
      );
    }

    const priceMinor = computeCardPriceMinor(entitlement.cardDiscountPercent);

    const batchOrder = await this.prisma.$transaction(async (tx) => {
      const occasions = await tx.occasion.findMany({
        where: { id: { in: occasionIds }, accountId },
      });
      if (occasions.length !== occasionIds.length) {
        throw new NotFoundException("One or more occasions were not found on this account");
      }
      const notApproved = occasions.filter((o) => o.status !== "approved");
      if (notApproved.length > 0) {
        throw new ConflictException(
          `Occasion ${notApproved[0]?.id} is not approved (status: ${notApproved[0]?.status})`,
        );
      }
      const noRecipient = occasions.find((o) => o.recipientId === null);
      if (noRecipient) {
        throw new BadRequestException(
          `Occasion ${noRecipient.id} has no recipient and cannot be checked out`,
        );
      }

      // Status-guarded updateMany, not a bare update — if a concurrent request
      // already consumed one of these occasions between the findMany above and
      // here, the count will be short and we abort instead of double-booking it.
      const { count } = await tx.occasion.updateMany({
        where: { id: { in: occasionIds }, accountId, status: "approved" },
        data: { status: "queued" },
      });
      if (count !== occasionIds.length) {
        throw new ConflictException(
          "One or more occasions were checked out by a concurrent request",
        );
      }

      const occasionsById = new Map(occasions.map((o) => [o.id, o]));

      // Each card is [card price (VAT-inclusive) + one stamp]. Postage is a
      // per-card charge on top and varies by the line's postage class, so it's
      // summed line-by-line rather than a flat order-level figure.
      const lines = dto.lines.map((line) => {
        const occasion = occasionsById.get(line.occasionId);
        // Guaranteed present: every occasionId was checked against
        // occasionsById's source (`occasions`) above.
        if (!occasion?.recipientId || !occasion.savedDesignId) {
          throw new ConflictException(
            `Occasion ${line.occasionId} is missing a recipient or design`,
          );
        }
        return {
          batchOrderId: "", // set after the order is created
          recipientId: occasion.recipientId,
          occasionId: occasion.id,
          savedDesignId: occasion.savedDesignId,
          shippingAddressLine1: line.shippingAddressLine1,
          shippingAddressLine2: line.shippingAddressLine2 ?? null,
          shippingAddressCity: line.shippingAddressCity,
          shippingAddressPostcode: line.shippingAddressPostcode,
          dispatchOption: line.dispatchOption,
          postageClass: line.postageClass,
          priceMinor,
          postageMinor: computePostageMinor(line.postageClass),
          status: "approved" as const,
        };
      });

      const subtotalMinor = lines.reduce((sum, line) => sum + line.priceMinor, 0);
      const postageMinor = lines.reduce((sum, line) => sum + line.postageMinor, 0);

      const order = await tx.batchOrder.create({
        data: {
          accountId,
          // Null for guest one-off purchases — no acting user. See docs/adr/0025.
          createdByUserId: actorUserId,
          status: "draft",
          subtotalMinor,
          postageMinor,
          totalMinor: subtotalMinor + postageMinor,
        },
      });

      await tx.orderRecipient.createMany({
        data: lines.map((line) => ({ ...line, batchOrderId: order.id })),
      });

      return tx.batchOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: ORDER_RECIPIENTS_INCLUDE,
      });
    });

    // Guest orders have no acting user to attribute (see docs/adr/0025); the
    // BatchOrder row is the record. Account orders always audit.
    if (actorUserId) {
      await this.audit.record({
        accountId,
        actorUserId,
        action: "create",
        targetType: "BatchOrder",
        targetId: batchOrder.id,
        metadata: { lineCount: dto.lines.length, totalMinor: batchOrder.totalMinor },
      });
    }
    return batchOrder;
  }

  async list(
    accountId: string,
    actorUserId: string,
    query: ListBatchOrdersQueryDto,
  ): Promise<Paginated<BatchOrder>> {
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 25);
    const where: Prisma.BatchOrderWhereInput = {
      accountId,
      ...(query.status && { status: query.status }),
    };

    // Two plain queries, not a $transaction — a paginated total needn't be a
    // consistent snapshot with the page, and an explicit read transaction is
    // what misbehaves on a pgBouncer pool (see docs/go-live-runbook.md §1c).
    const items = await this.prisma.batchOrder.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: "desc" },
      include: ORDER_RECIPIENTS_INCLUDE,
    });
    const total = await this.prisma.batchOrder.count({ where });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "list",
      targetType: "BatchOrder",
      targetId: accountId,
      metadata: { status: query.status ?? null, page },
    });

    return { items, total, page, perPage };
  }

  async findOne(accountId: string, actorUserId: string, id: string): Promise<BatchOrder> {
    const order = await this.prisma.batchOrder.findFirst({
      where: { id, accountId },
      include: ORDER_RECIPIENTS_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException("Batch order not found");
    }
    await this.audit.record({
      accountId,
      actorUserId,
      action: "view",
      targetType: "BatchOrder",
      targetId: id,
    });
    return order;
  }

  async checkout(
    accountId: string,
    actorUserId: string | null,
    id: string,
    options?: { customerEmail?: string; successPath?: string; cancelPath?: string },
  ): Promise<CheckoutResult> {
    const existing = await this.prisma.batchOrder.findFirst({
      where: { id, accountId },
      include: ORDER_RECIPIENTS_INCLUDE,
    });
    if (!existing) {
      throw new NotFoundException("Batch order not found");
    }
    if (existing.status !== "draft") {
      throw new ConflictException(`Batch order is "${existing.status}", not a draft`);
    }

    // Status-guarded, and BEFORE the Stripe call — not after. Calling Stripe
    // first would let two concurrent checkout requests each create a real,
    // live Checkout Session before either learns it lost the DB race,
    // leaking an orphaned (unreturned, but still payable-in-principle)
    // session per collision. Guarding first means at most one request ever
    // reaches Stripe for a given draft.
    const { count } = await this.prisma.batchOrder.updateMany({
      where: { id, accountId, status: "draft" },
      data: { status: "pending_payment" },
    });
    if (count === 0) {
      throw new ConflictException("Batch order was already checked out by a concurrent request");
    }

    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    // Guest checkout returns to public /gift pages (a guest has no session, so
    // the authenticated /batch-orders/* return pages would bounce them to login).
    const successPath = options?.successPath ?? "/batch-orders/success";
    const cancelPath = options?.cancelPath ?? "/batch-orders/cancelled";
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: existing.currency.toLowerCase(),
              unit_amount: existing.totalMinor,
              product_data: {
                name: `Kudos Cards order — ${existing.orderRecipients.length} card(s)`,
              },
            },
            quantity: 1,
          },
        ],
        // Prefill the buyer's email for guest checkout (Stripe also uses it for
        // the receipt). Account holders leave it unset — Stripe collects it.
        ...(options?.customerEmail && { customer_email: options.customerEmail }),
        success_url: `${webAppUrl}${successPath}?batchOrderId=${existing.id}`,
        cancel_url: `${webAppUrl}${cancelPath}?batchOrderId=${existing.id}`,
        metadata: { batchOrderId: existing.id, accountId },
      });
    } catch (error) {
      // Compensating action: we already claimed pending_payment above, so a
      // failed Stripe call must hand the draft back rather than leave the
      // order stuck in pending_payment with no Checkout Session behind it.
      await this.prisma.batchOrder.updateMany({
        where: { id, accountId, status: "pending_payment" },
        data: { status: "draft" },
      });
      throw error;
    }

    await this.prisma.batchOrder.update({
      where: { id },
      data: {
        paymentMethod: "card",
        stripePaymentIntentId:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
      },
    });

    if (actorUserId) {
      await this.audit.record({
        accountId,
        actorUserId,
        action: "checkout",
        targetType: "BatchOrder",
        targetId: id,
        metadata: { stripeCheckoutSessionId: session.id },
      });
    }

    if (!session.url) {
      throw new ConflictException("Stripe did not return a checkout URL");
    }
    return { checkoutUrl: session.url };
  }

  /**
   * Cancellable from "draft" (never checked out) or "pending_payment" (checked
   * out but the customer abandoned/never completed Stripe Checkout) — not
   * from "paid" onward, since ADR 0008 defers refunds to a later phase. A
   * pending_payment order left with no path to release is otherwise stuck
   * forever, holding its occasions "queued" indefinitely.
   */
  async cancel(accountId: string, actorUserId: string, id: string): Promise<BatchOrder> {
    const order = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.batchOrder.updateMany({
        where: { id, accountId, status: { in: ["draft", "pending_payment"] } },
        data: { status: "cancelled" },
      });
      if (count === 0) {
        const existing = await tx.batchOrder.findFirst({ where: { id, accountId } });
        if (!existing) {
          throw new NotFoundException("Batch order not found");
        }
        throw new ConflictException(
          `Batch order is "${existing.status}", not a draft or pending payment`,
        );
      }

      const orderRecipients = await tx.orderRecipient.findMany({ where: { batchOrderId: id } });
      const occasionIds = orderRecipients
        .map((r) => r.occasionId)
        .filter((occasionId): occasionId is string => occasionId !== null);

      if (occasionIds.length > 0) {
        await tx.occasion.updateMany({
          where: { id: { in: occasionIds }, accountId, status: "queued" },
          data: { status: "approved" },
        });
      }
      await tx.orderRecipient.deleteMany({ where: { batchOrderId: id } });

      return tx.batchOrder.findUniqueOrThrow({
        where: { id },
        include: ORDER_RECIPIENTS_INCLUDE,
      });
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "cancel",
      targetType: "BatchOrder",
      targetId: id,
    });
    return order;
  }
}
