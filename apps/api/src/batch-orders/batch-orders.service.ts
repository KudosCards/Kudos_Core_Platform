import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PostageClass, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { AuditService } from "../audit/audit.service";
import type { EnvConfig } from "../config/env.schema";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";
import { runSerializable } from "../common/run-serializable";
import type { CheckoutResult } from "../common/checkout-result";
import { STRIPE_CLIENT } from "../billing/stripe-client.provider";
import { computeCardPriceMinor, computePostageMinor } from "../billing/billing.constants";
import {
  POSTAGE_LEAD_DAYS,
  backArtworkInReservedFooter,
  computeDispatchDate,
  computePricingBreakdown,
  deliverByWindow,
  isoDay,
  sendNowDispatchDate,
  startOfUtcDay,
  unresolvedMergeTokens,
  type BatchOrderPreflight,
  type DesignDocument,
  type MergeContext,
  type OccasionRedateCard,
  type OccasionRedateSummary,
  type PreflightIssue,
} from "@kudos/shared-types";
import { MessagesService } from "../messages/messages.service";
import { RecipientsService } from "../recipients/recipients.service";
import { UK_POSTCODE_REGEX } from "../common/uk-postcode";
import type { CreateBatchOrderDto, CreateBatchOrderLineDto } from "./dto/create-batch-order.dto";
import type { ListBatchOrdersQueryDto } from "./dto/list-batch-orders-query.dto";
import type { QuickSendDto } from "./dto/quick-send.dto";
import type { BulkSendDto } from "./dto/bulk-send.dto";
import type { PreflightBatchOrderDto } from "./dto/preflight-batch-order.dto";

const ORDER_RECIPIENTS_INCLUDE = { orderRecipients: true } as const;

export type BatchOrder = Prisma.BatchOrderGetPayload<{ include: typeof ORDER_RECIPIENTS_INCLUDE }>;

/**
 * The single-order detail read: each card line carries the recipient's name (so
 * the buyer sees *who* each card is for, not just a postcode), its fulfilment
 * stage + Royal Mail tracking reference, and its digital-message-page slug. This
 * heavier shape is used only by findOne — the orders *list* stays lean on
 * ORDER_RECIPIENTS_INCLUDE. See docs/adr/0109-order-detail.md.
 */
const ORDER_DETAIL_INCLUDE = {
  orderRecipients: {
    orderBy: { createdAt: "asc" },
    include: {
      recipient: { select: { firstName: true, lastName: true } },
      occasion: { select: { dispatchDate: true } },
      fulfillmentJob: { select: { status: true, trackingReference: true } },
      messagePageLink: { select: { slug: true } },
    },
  },
} satisfies Prisma.BatchOrderInclude;

type OrderDetailPayload = Prisma.BatchOrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;

/** One card line for the buyer's order detail: the raw OrderRecipient scalars
 * plus the flattened recipient name, fulfilment stage, tracking and message-page
 * slug. Structurally matches @kudos/shared-types' orderRecipientLineSchema. */
export type OrderRecipientLine = Omit<
  OrderDetailPayload["orderRecipients"][number],
  "recipient" | "occasion" | "fulfillmentJob" | "messagePageLink"
> & {
  recipientFirstName: string;
  recipientLastName: string;
  dispatchDate: Date | null;
  jobStatus: string | null;
  trackingReference: string | null;
  messagePageSlug: string | null;
};

export type BatchOrderDetail = Omit<OrderDetailPayload, "orderRecipients"> & {
  orderRecipients: OrderRecipientLine[];
};

/** Occasion statuses that can still be sent — a segment send only supersedes a
 * natural occasion still in one of these, so it never un-does an in-flight send.
 * See docs/adr/0107-occasion-reconciliation.md. */
/**
 * A post-by date can never be in the past — you cannot post a card yesterday.
 *
 * Back-computing from a date that's nearly here (a birthday tomorrow, with three
 * working days of postage lead) lands before today. Stored as-is, the card is
 * born into the ops "overdue" band, which is an SLA-breach signal — a false
 * alarm for an order placed a moment ago. It is due *now*, not late.
 */
function notBeforeToday(dispatchDate: Date): Date {
  const soonest = sendNowDispatchDate();
  return dispatchDate.getTime() < soonest.getTime() ? soonest : dispatchDate;
}

/**
 * Whether this send dates each card by its own recipient's occasion.
 *
 * Default *on*: a bulk send with no shared delivery date is a send of birthday
 * cards far more often than it is a same-day campaign, and the failure modes are
 * not symmetric — a campaign card posted on someone's birthday is odd, a
 * birthday card posted eleven months early is a refund. A sender who genuinely
 * wants one shared date says so, either by choosing a delivery date or by
 * passing `useOccasionDates: false`.
 */
function usesOccasionDates(dto: BulkSendDto): boolean {
  return dto.useOccasionDates ?? !dto.deliverBy;
}

const RECONCILABLE_OCCASION_STATUSES = ["scheduled", "pending_approval", "approved"] as const;

/** A card can only be posted to a contact with a complete, valid UK address. */
function hasMailableAddress(recipient: Prisma.RecipientGetPayload<object>): boolean {
  return (
    !!recipient.addressLine1?.trim() &&
    !!recipient.addressCity?.trim() &&
    !!recipient.addressPostcode &&
    UK_POSTCODE_REGEX.test(recipient.addressPostcode)
  );
}

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
    return this.quickSendMany(accountId, actorUserId, [dto]);
  }

  /**
   * Multi-card guided send: turn several freshly-designed saved cards (each with
   * its own recipient + address) into ONE draft batch order in a single step —
   * the money path behind a basket checkout. Each card becomes an approved
   * one-off occasion; they're then checked out together as one order (one
   * payment). Reuses `create`, so the plan's per-order cap still applies. */
  async quickSendMany(
    accountId: string,
    actorUserId: string | null,
    items: QuickSendDto[],
  ): Promise<BatchOrder> {
    if (items.length === 0) {
      throw new BadRequestException("At least one card is required");
    }
    const lines: CreateBatchOrderLineDto[] = [];
    for (const dto of items) {
      lines.push(await this.buildQuickSendLine(accountId, actorUserId, dto));
    }
    return this.create(accountId, actorUserId, { lines });
  }

  /**
   * Resolve an ad-hoc send's timing from an optional arrive-by (`deliverBy`)
   * date. "Send now" (no date) posts today. A scheduled send back-computes the
   * post-by (`dispatchDate`) from the arrive-by date via the same working-days
   * lead engine occasions use, so a paid-now card is held in the ops queue until
   * it's due. Validates the date is within the bookable window and its computed
   * post date isn't already in the past. Pure-ish (reads `new Date()`). See
   * docs/adr/0130-scheduled-sends.md.
   */
  private resolveSendSchedule(
    deliverBy: string | undefined,
    postageClass: PostageClass,
  ): { occasionDate: Date; dispatchDate: Date; scheduled: boolean } {
    const today = startOfUtcDay(new Date());
    if (!deliverBy) {
      // "Send now" posts today only if we're still before the same-day cut-off on
      // a working day; after it (or on a weekend/holiday) it posts the next
      // working day, so the ops queue reads it as due then rather than as
      // overdue-today for a collection that has already gone. See ADR 0160.
      return { occasionDate: today, dispatchDate: sendNowDispatchDate(), scheduled: false };
    }
    const arriveBy = startOfUtcDay(new Date(`${deliverBy}T00:00:00.000Z`));
    if (Number.isNaN(arriveBy.getTime())) {
      throw new BadRequestException("Invalid delivery date");
    }
    const { earliest, latest } = deliverByWindow(postageClass, today);
    if (arriveBy.getTime() > startOfUtcDay(latest).getTime()) {
      throw new BadRequestException("That delivery date is too far ahead to schedule.");
    }
    const dispatchDate = computeDispatchDate(arriveBy, POSTAGE_LEAD_DAYS[postageClass]);
    if (dispatchDate.getTime() < today.getTime()) {
      const soonest = startOfUtcDay(earliest).toISOString().slice(0, 10);
      throw new BadRequestException(
        `That delivery date is too soon — the earliest we can schedule for is ${soonest}.`,
      );
    }
    return { occasionDate: arriveBy, dispatchDate, scheduled: true };
  }

  /** Create the recipient + approved one-off occasion for a single guided-send
   * card, returning the order line that consumes it. Shared by quickSend and
   * quickSendMany so the single- and multi-card paths can never drift. */
  private async buildQuickSendLine(
    accountId: string,
    actorUserId: string | null,
    dto: QuickSendDto,
  ): Promise<CreateBatchOrderLineDto> {
    const savedDesign = await this.prisma.savedDesign.findFirst({
      where: { id: dto.savedDesignId, accountId },
    });
    if (!savedDesign) {
      throw new NotFoundException("Design not found");
    }

    // Who this card is for. Three ways in (see the CRM-widget ADR):
    //  - recipientId → an existing address-book contact, reused as-is (no new
    //    row, so no duplicate and no cap hit). The dto's address still carries
    //    the shipping details for this order line, so an edited address applies
    //    to the send without mutating the stored contact.
    //  - new contact, saveToContacts !== false (the default) → the audited,
    //    cap-checked create, so the guided path can't sidestep the plan limit.
    //  - new contact, saveToContacts === false → a hidden one-off (archived).
    let recipient: { id: string };
    if (dto.recipientId) {
      const existing = await this.prisma.recipient.findFirst({
        where: { id: dto.recipientId, accountId },
      });
      if (!existing) {
        throw new NotFoundException("Contact not found on this account");
      }
      recipient = existing;
    } else {
      const contactData = {
        firstName: dto.firstName,
        lastName: dto.lastName,
        addressLine1: dto.shippingAddressLine1,
        addressLine2: dto.shippingAddressLine2,
        addressCity: dto.shippingAddressCity,
        addressPostcode: dto.shippingAddressPostcode,
      };
      recipient =
        dto.saveToContacts === false
          ? await this.recipients.createOneOff(accountId, actorUserId, contactData)
          : await this.recipients.create(accountId, actorUserId, contactData);
    }

    // A one-off occasion, created already `approved` with the design attached —
    // the guided flow is the human decision that the manual approve step
    // represents, so there's nothing left to approve. dispatchOption `asap`
    // means a person checks it out (which is exactly what happens next).
    // "Send now" ships today; a scheduled send back-computes its post-by date
    // from the chosen arrive-by so the ops queue holds it until due (rather than
    // reading as overdue). See docs/adr/0119 and 0130.
    const schedule = this.resolveSendSchedule(dto.deliverBy, dto.postageClass);
    const occasion = await this.prisma.occasion.create({
      data: {
        accountId,
        recipientId: recipient.id,
        type: dto.occasionType ?? "bespoke_campaign",
        source: "one_off_campaign",
        occasionDate: schedule.occasionDate,
        dispatchDate: schedule.dispatchDate,
        status: "approved",
        savedDesignId: savedDesign.id,
        dispatchOption: "asap",
        postageClass: dto.postageClass,
      },
    });

    return {
      occasionId: occasion.id,
      shippingAddressLine1: dto.shippingAddressLine1,
      shippingAddressLine2: dto.shippingAddressLine2,
      shippingAddressCity: dto.shippingAddressCity,
      shippingAddressPostcode: dto.shippingAddressPostcode,
      dispatchOption: "asap",
      postageClass: dto.postageClass,
      messagePageId: dto.messagePageId,
    };
  }

  /**
   * Bulk send: post ONE saved design to a set of existing contacts in a single
   * order (one payment). Each contact's name and postal address come straight
   * off their stored Recipient record — nothing is re-keyed. Every contact
   * becomes an approved one-off occasion carrying the design, then they're all
   * checked out together via the same create(). Reuses the plan's per-order cap
   * and the money path. See docs/adr/0027-bulk-send-to-contacts.md.
   */
  async bulkSend(
    accountId: string,
    actorUserId: string | null,
    dto: BulkSendDto,
  ): Promise<BatchOrder> {
    // Check the plan's per-order cap up front — before creating any occasions —
    // so an over-cap bulk send fails cleanly instead of leaving orphaned
    // approved occasions behind (create() re-checks it as the real guard).
    const entitlement = await this.entitlements.getForAccount(accountId);
    if (dto.recipientIds.length > entitlement.batchOrderMaxSize) {
      throw new ForbiddenException(
        `This plan allows up to ${entitlement.batchOrderMaxSize} cards per order`,
      );
    }

    const savedDesign = await this.prisma.savedDesign.findFirst({
      where: { id: dto.savedDesignId, accountId },
    });
    if (!savedDesign) {
      throw new NotFoundException("Design not found");
    }

    // Fetch every selected contact, scoped to the account. A short count means
    // one or more ids don't belong here — fail rather than silently drop them.
    const recipients = await this.prisma.recipient.findMany({
      where: { id: { in: dto.recipientIds }, accountId },
    });
    if (recipients.length !== dto.recipientIds.length) {
      throw new NotFoundException("One or more contacts were not found on this account");
    }

    // A card can only be posted to a complete, valid UK address. Rather than
    // silently skip contacts that lack one, surface exactly who needs fixing so
    // the sender can add an address (or deselect them) before paying.
    const missingAddress = recipients.filter((r) => !hasMailableAddress(r));
    if (missingAddress.length > 0) {
      const names = missingAddress.map((r) => `${r.firstName} ${r.lastName}`).join(", ");
      throw new BadRequestException(
        `These contacts need a full UK postal address before you can send to them: ${names}`,
      );
    }

    // Which recipients are sending *via* a natural occasion (e.g. a birthday
    // picked from the birthday segment). For those we reuse that occasion as the
    // send record rather than minting a superseding one-off — so the card's
    // calendar event sits on the actual birthday, keeps its birthday
    // classification, and no duplicate occasion is created. Validated +
    // account-scoped. See docs/adr/0119.
    // Two different answers to "when does this post?" — refuse rather than pick
    // one silently, which is how the original bug read to the sender.
    if (dto.useOccasionDates === true && dto.deliverBy) {
      throw new BadRequestException(
        "Choose either a delivery date for the whole send or each recipient's own occasion date — not both.",
      );
    }

    const reconciledByRecipient = await this.resolveReconcile(accountId, dto);

    const byId = new Map(recipients.map((r) => [r.id, r]));
    // "Send now" (no deliverBy) posts today — dating the *dispatch* to today, not
    // a date back-computed from a future occasion, is why the ops queue reads it
    // as due now rather than overdue (ADR 0119). A scheduled send back-computes
    // its post-by date from the chosen arrive-by so it's paid now but held until
    // due (ADR 0130).
    const schedule = this.resolveSendSchedule(dto.deliverBy, dto.postageClass);
    const occasionIdByRecipient = new Map<string, string>();

    // Reconciled recipients: reuse the matched natural occasion. Attach the
    // design and move it to `approved` so the shared create() consumes it exactly
    // like a one-off — keeping its own occasionDate (the birthday) and type. The
    // post-by date is computed from that occasion's OWN date, never the batch's
    // send-timing: a segment send to "upcoming birthdays" posts each card timed
    // to that person's birthday, not all on one shared date. Grouped by computed
    // dispatch date so it's one updateMany per distinct date, not per card. The
    // manual "Schedule delivery" date the composer hides for event sends is only
    // consulted for the fresh bespoke occasions below. See ADR 0160.
    for (const [recipientId, { occasionId }] of reconciledByRecipient) {
      occasionIdByRecipient.set(recipientId, occasionId);
    }
    if (reconciledByRecipient.size > 0) {
      const idsByDispatch = new Map<number, string[]>();
      for (const { occasionId, occasionDate } of reconciledByRecipient.values()) {
        const dispatchDate = notBeforeToday(
          computeDispatchDate(occasionDate, POSTAGE_LEAD_DAYS[dto.postageClass]),
        );
        const key = dispatchDate.getTime();
        const ids = idsByDispatch.get(key) ?? [];
        ids.push(occasionId);
        idsByDispatch.set(key, ids);
      }
      for (const [dispatchTime, ids] of idsByDispatch) {
        await this.prisma.occasion.updateMany({
          where: { id: { in: ids }, accountId },
          data: {
            savedDesignId: savedDesign.id,
            dispatchOption: "asap",
            postageClass: dto.postageClass,
            dispatchDate: new Date(dispatchTime),
            status: "approved",
          },
        });
      }
    }

    // Every other recipient gets a fresh approved one-off occasion carrying the
    // design. Built up front with client-generated ids and inserted in a SINGLE
    // createMany, so a 10,000-card send is one round-trip — not one INSERT per
    // recipient. Its occasionDate is the send moment (a bespoke event created
    // now); its dispatch is today. See docs/adr/0118.
    const freshRecipientIds = dto.recipientIds.filter((id) => !reconciledByRecipient.has(id));
    for (const id of freshRecipientIds) {
      occasionIdByRecipient.set(id, randomUUID());
    }
    if (freshRecipientIds.length > 0) {
      await this.prisma.occasion.createMany({
        data: freshRecipientIds.map((id) => ({
          id: occasionIdByRecipient.get(id)!,
          accountId,
          recipientId: id,
          type: dto.occasionType ?? "bespoke_campaign",
          source: "one_off_campaign",
          occasionDate: schedule.occasionDate,
          dispatchDate: schedule.dispatchDate,
          status: "approved",
          savedDesignId: savedDesign.id,
          dispatchOption: "asap",
          postageClass: dto.postageClass,
        })),
      });
    }

    const lines: CreateBatchOrderLineDto[] = dto.recipientIds.map((id) => {
      const recipient = byId.get(id)!;
      return {
        occasionId: occasionIdByRecipient.get(id)!,
        // Non-null asserted: the missing-address guard above proved these set.
        shippingAddressLine1: recipient.addressLine1!,
        shippingAddressLine2: recipient.addressLine2 ?? undefined,
        shippingAddressCity: recipient.addressCity!,
        shippingAddressPostcode: recipient.addressPostcode!,
        dispatchOption: "asap",
        postageClass: dto.postageClass,
        messagePageId: dto.messagePageId,
      };
    });
    return this.create(accountId, actorUserId, { lines });
  }

  /** How far back a prior order of the same design counts as a possible
   * accidental re-send in the preflight duplicate check. */
  private static readonly DUPLICATE_WINDOW_DAYS = 30;
  /** Per bucket, how many affected recipients to return for drill-in (the true
   * count is always returned in full). Keeps the payload small on huge runs. */
  private static readonly PREFLIGHT_SAMPLE_CAP = 100;

  /**
   * Pre-send check for a bulk run (ADR 0118): validate the whole selection —
   * address quality, unresolved merge tokens per recipient, and recent duplicate
   * sends of the same design — and return the exact price, *before* any order or
   * payment. Advisory and read-only: it creates nothing, so it never blocks; the
   * real guards still run at bulkSend().
   */
  async preflight(accountId: string, dto: PreflightBatchOrderDto): Promise<BatchOrderPreflight> {
    const entitlement = await this.entitlements.getForAccount(accountId);
    const design = await this.prisma.savedDesign.findFirst({
      where: { id: dto.savedDesignId, accountId },
    });
    if (!design) throw new NotFoundException("Design not found");
    const document = design.document as unknown as DesignDocument;

    // Account-scoped: ids that aren't on this account are silently ignored (the
    // check is advisory; bulkSend() is the one that fails on a mismatch).
    const recipients = await this.prisma.recipient.findMany({
      where: { id: { in: dto.recipientIds }, accountId },
    });

    // Recipients recently ordered this same design — a likely double-send. Only
    // orders that actually reached payment count: a draft or pending_payment
    // order was never sent, so warning about it would be a false alarm (and a
    // cancelled order deletes its lines, so it can't match anyway). Scoping to
    // paid/fulfilling/completed keeps "recently sent" meaning genuinely sent.
    const cutoff = new Date(
      Date.now() - BatchOrdersService.DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const recentRows = await this.prisma.orderRecipient.findMany({
      where: {
        recipientId: { in: recipients.map((r) => r.id) },
        savedDesignId: dto.savedDesignId,
        createdAt: { gt: cutoff },
        batchOrder: { status: { in: ["paid", "fulfilling", "completed"] } },
      },
      select: { recipientId: true },
    });
    const recentlySent = new Set(recentRows.map((r) => r.recipientId));

    type BucketKey = "missingAddress" | "invalidPostcode" | "unresolvedTokens" | "duplicate";
    const sample: Record<BucketKey, PreflightIssue[]> = {
      missingAddress: [],
      invalidPostcode: [],
      unresolvedTokens: [],
      duplicate: [],
    };
    const count: Record<BucketKey, number> = {
      missingAddress: 0,
      invalidPostcode: 0,
      unresolvedTokens: 0,
      duplicate: 0,
    };
    const flag = (key: BucketKey, issue: PreflightIssue) => {
      count[key] += 1;
      if (sample[key].length < BatchOrdersService.PREFLIGHT_SAMPLE_CAP) sample[key].push(issue);
    };

    const now = new Date();
    // The occasion each card will carry (bulkSend creates a one-off occasion), so
    // {occasion}/{occasionDate} resolve exactly as they will in production — only
    // genuinely missing custom-field tokens are flagged.
    const occasionLabel = dto.occasionType ?? "bespoke_campaign";
    let ready = 0;
    // Cards that will actually be charged: only recipients with a valid, mailable
    // UK address get an order line (bulkSend refuses to post to the rest), so the
    // price must be over this subset — never the whole selection — or it would
    // overstate the charge whenever a contact is missing an address.
    let mailable = 0;

    for (const r of recipients) {
      const name = `${r.firstName} ${r.lastName}`.trim();
      let clean = true;
      let addressOk = true;

      const hasParts =
        !!r.addressLine1?.trim() && !!r.addressCity?.trim() && !!r.addressPostcode?.trim();
      if (!hasParts) {
        flag("missingAddress", { recipientId: r.id, name, detail: "No postal address" });
        clean = false;
        addressOk = false;
      } else if ((r.addressCountry ?? "GB") !== "GB") {
        flag("invalidPostcode", {
          recipientId: r.id,
          name,
          detail: `Non-UK address (${r.addressCountry})`,
        });
        clean = false;
        addressOk = false;
      } else if (!UK_POSTCODE_REGEX.test(r.addressPostcode!)) {
        flag("invalidPostcode", {
          recipientId: r.id,
          name,
          detail: `Postcode “${r.addressPostcode}” looks invalid`,
        });
        clean = false;
        addressOk = false;
      }
      if (addressOk) mailable += 1;

      const ctx: MergeContext = {
        firstName: r.firstName,
        lastName: r.lastName,
        occasion: occasionLabel,
        occasionDate: now,
        customFields: (r.customFields as Record<string, string> | null) ?? null,
      };
      const unresolved = unresolvedMergeTokens(document, ctx);
      if (unresolved.length > 0) {
        flag("unresolvedTokens", { recipientId: r.id, name, detail: unresolved.join(", ") });
        clean = false;
      }

      if (recentlySent.has(r.id)) {
        flag("duplicate", {
          recipientId: r.id,
          name,
          detail: `Sent this design in the last ${BatchOrdersService.DUPLICATE_WINDOW_DAYS} days`,
        });
        clean = false;
      }

      if (clean) ready += 1;
    }

    // What "no delivery date" would actually do to this selection's timing.
    // Occasion dating is the default (ADR 0167), so a sender picking "send now"
    // needs to know whether that means today or means spread across ten months.
    // The same lookup bulkSend uses, over the same mailable subset the price
    // covers — a preview computed a different way would eventually disagree with
    // the send, which is worse than no preview at all.
    const mailableIds = recipients.filter(hasMailableAddress).map((r) => r.id);
    const dated = [...(await this.findDatedOccasions(accountId, mailableIds)).values()]
      .map((match) => match.occasionDate)
      .sort((a, b) => a.getTime() - b.getTime());
    const occasionDated = {
      count: dated.length,
      earliest: dated.length > 0 ? isoDay(dated[0]!) : null,
      latest: dated.length > 0 ? isoDay(dated[dated.length - 1]!) : null,
    };

    const total = recipients.length;
    const cardPer = computeCardPriceMinor(entitlement.cardDiscountPercent);
    const postagePer = computePostageMinor(dto.postageClass);
    // Price only the mailable cards — the exact set that will be charged.
    const price = computePricingBreakdown({
      cardCount: mailable,
      cardSubtotalInclVatMinor: cardPer * mailable,
      postageMinor: postagePer * mailable,
    });

    return {
      total,
      ready,
      missingAddress: { count: count.missingAddress, sample: sample.missingAddress },
      invalidPostcode: { count: count.invalidPostcode, sample: sample.invalidPostcode },
      unresolvedTokens: { count: count.unresolvedTokens, sample: sample.unresolvedTokens },
      duplicate: { count: count.duplicate, sample: sample.duplicate },
      price,
      occasionDated,
      // Design-level, so the composer can say "your back artwork is being cut"
      // before payment rather than leaving it to be noticed on the printed card.
      backArtworkClipped: backArtworkInReservedFooter(document),
    };
  }

  /**
   * Resolve `dto.reconcile` to a validated recipientId → naturalOccasionId map.
   * Only occasions that are on this account, belong to the paired recipient (who
   * must also be in `recipientIds`), are natural (not a `one_off_campaign` send),
   * and are still sendable survive — anything else is silently dropped rather
   * than failing the whole send. See docs/adr/0107 and docs/adr/0119.
   *
   * The mapped natural occasion is *reused* as the send record (not superseded
   * by a new one-off): bulkSend attaches the design to it and checks it out
   * directly, so the send keeps the birthday's own date and classification.
   */
  private async resolveReconcile(
    accountId: string,
    dto: BulkSendDto,
  ): Promise<Map<string, { occasionId: string; occasionDate: Date }>> {
    const result = await this.resolveClientReconcile(accountId, dto);

    // Server-side matching, and the reason this method exists in two halves.
    //
    // The client half below only ever fires when the composer was seeded from a
    // segment — that is the only place it builds a `reconcile` list. So a send
    // to the same people picked from a *list*, or by hand, arrived with nothing
    // to reconcile and every card was dated today, even though each recipient
    // had a birthday on file. Same contacts, same birthdays, different answer
    // depending on which button started the flow.
    //
    // When the sender asks for occasion dating, the occasions are therefore
    // found here rather than taken on trust from the browser. The API already
    // holds them; it never needed telling.
    if (!usesOccasionDates(dto)) return result;

    const unmatched = dto.recipientIds.filter((id) => !result.has(id));
    if (unmatched.length === 0) return result;

    for (const [recipientId, match] of await this.findDatedOccasions(accountId, unmatched)) {
      result.set(recipientId, match);
    }
    return result;
  }

  /**
   * The eligible dated occasion for each of these recipients: the soonest one
   * still to come, so a card is timed to the next birthday rather than one
   * eleven months out.
   *
   * Deliberately the same eligibility the explicit path applies — account-owned,
   * not already a one-off campaign, in a reconcilable status — so a card dated
   * by this route and one dated by the composer can never disagree. Occasions
   * already in the past are skipped: posting a card for a birthday that has been
   * and gone would land it as overdue the moment it was ordered.
   */
  private async findDatedOccasions(
    accountId: string,
    recipientIds: string[],
  ): Promise<Map<string, { occasionId: string; occasionDate: Date }>> {
    const result = new Map<string, { occasionId: string; occasionDate: Date }>();
    if (recipientIds.length === 0) return result;

    const occasions = await this.prisma.occasion.findMany({
      where: {
        accountId,
        recipientId: { in: recipientIds },
        source: { not: "one_off_campaign" },
        status: { in: [...RECONCILABLE_OCCASION_STATUSES] },
        occasionDate: { gte: startOfUtcDay(new Date()) },
      },
      orderBy: { occasionDate: "asc" },
      select: { id: true, recipientId: true, occasionDate: true },
    });

    // Soonest first, so the first one seen per recipient is the one to use — the
    // next birthday, not one eleven months out.
    for (const occasion of occasions) {
      // `recipientId` is nullable on Occasion (an account-level date belongs to
      // nobody in particular); such a row can't date a card for a person.
      if (!occasion.recipientId || result.has(occasion.recipientId)) continue;
      result.set(occasion.recipientId, {
        occasionId: occasion.id,
        occasionDate: occasion.occasionDate,
      });
    }
    return result;
  }

  /** The composer's explicit "mark these as handled" list, validated and
   * account-scoped. Entries for recipients not being sent to are ignored. */
  private async resolveClientReconcile(
    accountId: string,
    dto: BulkSendDto,
  ): Promise<Map<string, { occasionId: string; occasionDate: Date }>> {
    const result = new Map<string, { occasionId: string; occasionDate: Date }>();
    if (!dto.reconcile?.length) return result;

    const selected = new Set(dto.recipientIds);
    const requested = dto.reconcile.filter((r) => selected.has(r.recipientId));
    if (requested.length === 0) return result;

    const valid = await this.prisma.occasion.findMany({
      where: {
        accountId,
        id: { in: requested.map((r) => r.occasionId) },
        recipientId: { in: requested.map((r) => r.recipientId) },
        source: { not: "one_off_campaign" },
        status: { in: [...RECONCILABLE_OCCASION_STATUSES] },
      },
      // occasionDate drives the reused occasion's own post-by date (the birthday),
      // so a segment send stays timed to each person's date. See ADR 0160.
      select: { id: true, recipientId: true, occasionDate: true },
    });
    const validByPair = new Map(valid.map((o) => [`${o.recipientId}:${o.id}`, o]));

    for (const { recipientId, occasionId } of requested) {
      const match = validByPair.get(`${recipientId}:${occasionId}`);
      if (match) {
        result.set(recipientId, { occasionId: match.id, occasionDate: match.occasionDate });
      }
    }
    return result;
  }

  /** Create the approved one-off occasion for one existing contact in a bulk
   * send, returning the order line addressed from that contact's own record. */
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
      // Pull the occasion's dispatch date so we can denormalise it onto the job
      // as its posting deadline (dueDate) — the ops queue's sort/filter spine.
      include: { occasion: { select: { dispatchDate: true } } },
    });
    await tx.orderRecipient.updateMany({
      where: { batchOrderId, status: "approved" },
      data: { status: "queued" },
    });
    await tx.fulfillmentJob.createMany({
      data: orderRecipients.map((recipient) => ({
        orderRecipientId: recipient.id,
        status: "pending" as const,
        // Null when the card has no occasion — no date-driven deadline.
        dueDate: recipient.occasion?.dispatchDate ?? null,
      })),
      skipDuplicates: true,
    });
    await this.messages.createForOrderRecipients(
      tx,
      orderRecipients.map((recipient) => recipient.id),
    );

    // Reconciliation legacy safety net (ADR 0107): a segment send now *reuses*
    // the natural occasion as its send record (ADR 0119), so no superseding
    // one-off is created and this is a no-op for new orders. It stays to settle
    // any pre-0119 order still in flight, whose campaign occasion supersedes a
    // natural one that must be consumed so it can't independently double-send.
    // Status-guarded (only still-sendable occasions) so an in-flight send is
    // never un-done, and idempotent — a redelivered webhook re-runs it as a no-op.
    const occasionIds = orderRecipients
      .map((r) => r.occasionId)
      .filter((id): id is string => id !== null);
    if (occasionIds.length > 0) {
      const superseding = await tx.occasion.findMany({
        where: { id: { in: occasionIds }, supersedesOccasionId: { not: null } },
        select: { supersedesOccasionId: true },
      });
      const supersededIds = superseding
        .map((o) => o.supersedesOccasionId)
        .filter((id): id is string => id !== null);
      if (supersededIds.length > 0) {
        await tx.occasion.updateMany({
          where: { id: { in: supersededIds }, status: { in: [...RECONCILABLE_OCCASION_STATUSES] } },
          data: { status: "skipped" },
        });
      }
    }
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

    // Any message page attached to a line (send flow, ADR 0132) must belong to
    // this account and still be active — the trust boundary, even though the UI
    // only offers the account's own pages. Settlement mints each card's QR link
    // onto the chosen page.
    const messagePageIds = [
      ...new Set(dto.lines.map((line) => line.messagePageId).filter((id): id is string => !!id)),
    ];
    if (messagePageIds.length > 0) {
      const found = await this.prisma.messagePage.count({
        where: { id: { in: messagePageIds }, accountId, status: "active" },
      });
      if (found !== messagePageIds.length) {
        throw new NotFoundException("One or more message pages were not found on this account");
      }
    }

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
          messagePageId: line.messagePageId ?? null,
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

  async findOne(accountId: string, actorUserId: string, id: string): Promise<BatchOrderDetail> {
    const order = await this.prisma.batchOrder.findFirst({
      where: { id, accountId },
      include: ORDER_DETAIL_INCLUDE,
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
    // Flatten the joined relations onto each line so the buyer's order page can
    // name every card, link its tracking, and reach its digital message page.
    const { orderRecipients, ...rest } = order;
    return {
      ...rest,
      orderRecipients: orderRecipients.map(
        ({ recipient, occasion, fulfillmentJob, messagePageLink, ...line }) => ({
          ...line,
          recipientFirstName: recipient.firstName,
          recipientLastName: recipient.lastName,
          dispatchDate: occasion?.dispatchDate ?? null,
          jobStatus: fulfillmentJob?.status ?? null,
          trackingReference: fulfillmentJob?.trackingReference ?? null,
          messagePageSlug: messagePageLink?.slug ?? null,
        }),
      ),
    };
  }

  async checkout(
    accountId: string,
    actorUserId: string | null,
    id: string,
    options?: {
      customerEmail?: string;
      successPath?: string;
      cancelPath?: string;
      successExtraParams?: Record<string, string>;
      resume?: boolean;
    },
  ): Promise<CheckoutResult> {
    const existing = await this.prisma.batchOrder.findFirst({
      where: { id, accountId },
      include: ORDER_RECIPIENTS_INCLUDE,
    });
    if (!existing) {
      throw new NotFoundException("Batch order not found");
    }
    // Payable from "draft" (first checkout) or "pending_payment" (a resume —
    // checkout was started but the buyer closed Stripe without paying, so the
    // order is stuck holding its occasions "queued" with no live session). Both
    // just need a fresh Checkout Session minted below. Anything past payment
    // (paid/fulfilling/completed) or cancelled is final and not re-payable.
    if (existing.status !== "draft" && existing.status !== "pending_payment") {
      throw new ConflictException(`Batch order is "${existing.status}", not payable`);
    }

    const webAppUrlForWallet = this.config.get("WEB_APP_URL", { infer: true });
    const successPathForWallet = options?.successPath ?? "/batch-orders/success";

    // The wallet is always spent first (ADR 0169). When it covers the whole
    // order there is nothing for Stripe to charge, so settle it here and hand
    // back the success page instead of a Checkout URL — every caller already
    // redirects to whatever this returns.
    //
    // Only from `draft`: a resume is already past this point and may be carrying
    // a reservation, which must not be double-spent.
    if (existing.status === "draft") {
      const paidFromWallet = await runSerializable(this.prisma, async (tx) => {
        const balance = await this.walletBalance(tx, accountId);
        if (balance < existing.totalMinor) return false;
        const { count } = await tx.batchOrder.updateMany({
          where: { id, accountId, status: "draft" },
          data: { status: "paid", paymentMethod: "wallet" },
        });
        if (count === 0) return false; // a concurrent request claimed it
        await tx.walletLedgerEntry.create({
          data: {
            accountId,
            type: "charge",
            amountMinor: -existing.totalMinor,
            balanceAfterMinor: balance - existing.totalMinor,
            reference: `order:${id}`,
          },
        });
        await this.settleFulfillment(tx, id);
        return true;
      });
      if (paidFromWallet) {
        if (actorUserId) {
          await this.audit.record({
            accountId,
            actorUserId,
            action: "wallet_payment_succeeded",
            targetType: "BatchOrder",
            targetId: id,
            metadata: { totalMinor: existing.totalMinor },
          });
        }
        const query = new URLSearchParams({ batchOrderId: id, ...options?.successExtraParams });
        return { checkoutUrl: `${webAppUrlForWallet}${successPathForWallet}?${query.toString()}` };
      }
    }

    // The status-guarded transition runs BEFORE the Stripe call — not after.
    // Calling Stripe first would let two concurrent checkout requests each
    // create a real, live Checkout Session before either learns it lost the DB
    // race, leaking an orphaned (unreturned, but still payable-in-principle)
    // session per collision. Guarding first means at most one request ever
    // reaches Stripe for a given order.
    //
    // A first checkout ("Pay" on a draft) and a resume ("Resume checkout" on an
    // abandoned pending_payment order) are indistinguishable by stored state —
    // they differ only in timing — so the caller signals a resume explicitly
    // via `options.resume`. Without that, a first checkout whose loser happens
    // to read the winner's freshly-set `pending_payment` would be misread as a
    // resume and sent to Stripe a second time. The explicit intent closes that
    // hole: an unflagged request on a non-draft order is always a 409.
    //
    // `movedFromDraft` records whether we claimed a *draft*, so a failed Stripe
    // call hands only a draft back (a resume was already pending_payment).
    //
    // The wallet draw is reserved in this same transaction, not computed here
    // and debited when payment settles: two concurrent checkouts would each size
    // their Stripe charge against the same balance, and the second debit would
    // overdraw it. Reserving under the claim means a balance can back exactly one
    // order at a time.
    let movedFromDraft = false;
    let walletApplied = 0;
    if (existing.status === "draft") {
      walletApplied = await runSerializable(this.prisma, async (tx) => {
        const balance = await this.walletBalance(tx, accountId);
        // Never the full total here — that case settled above and returned.
        const draw = Math.min(
          BatchOrdersService.walletDrawFor(balance, existing.totalMinor),
          Math.max(0, existing.totalMinor - BatchOrdersService.STRIPE_MINIMUM_CHARGE_MINOR),
        );
        const { count } = await tx.batchOrder.updateMany({
          where: { id, accountId, status: "draft" },
          data: { status: "pending_payment", walletAppliedMinor: draw },
        });
        if (count === 0) {
          throw new ConflictException(
            "Batch order was already checked out by a concurrent request",
          );
        }
        if (draw > 0) {
          await tx.walletLedgerEntry.create({
            data: {
              accountId,
              type: "charge",
              amountMinor: -draw,
              balanceAfterMinor: balance - draw,
              reference: `order:${id}:wallet`,
            },
          });
        }
        return draw;
      });
      movedFromDraft = true;
    } else {
      // Already pending_payment (checked existing.status above). Only an
      // explicit resume may mint a fresh session; anything else is a concurrent
      // double-submit of a first checkout and must lose. The compare-and-swap
      // on updatedAt also serialises two concurrent *resumes* of the same
      // snapshot — the loser's WHERE no longer matches, so it 409s too.
      if (!options?.resume) {
        throw new ConflictException("Batch order was already checked out by a concurrent request");
      }
      const { count } = await this.prisma.batchOrder.updateMany({
        where: { id, accountId, status: "pending_payment", updatedAt: existing.updatedAt },
        data: { status: "pending_payment" },
      });
      if (count === 0) {
        throw new ConflictException("Batch order was already checked out by a concurrent request");
      }
      // A resume re-uses the reservation the first attempt already took. Taking
      // it again would debit the wallet twice for one order.
      walletApplied = existing.walletAppliedMinor;
    }

    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    // Guest checkout returns to public /gift pages (a guest has no session, so
    // the authenticated /batch-orders/* return pages would bounce them to login).
    const successPath = options?.successPath ?? "/batch-orders/success";
    const cancelPath = options?.cancelPath ?? "/batch-orders/cancelled";
    // e.g. the guest claim token, so the success page can offer account-claiming.
    const successQuery = new URLSearchParams({
      batchOrderId: existing.id,
      ...options?.successExtraParams,
    });
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.create({
        mode: "payment",
        // No `payment_method_types` — omitting it lets Stripe-hosted Checkout
        // present every method enabled in the Dashboard, including the Apple Pay
        // / Google Pay / Link wallets, instead of a hardcoded card-only list.
        // This is what surfaces Apple Pay for Safari buyers (desktop + mobile)
        // with no domain registration on our side. The webhook only fulfils on a
        // confirmed (payment_status "paid") session, so enabling a
        // delayed-notification method here can never fulfil before we're paid.
        // See docs/adr/0126-checkout-payment-methods.md.
        line_items: [
          {
            price_data: {
              currency: existing.currency.toLowerCase(),
              unit_amount: existing.totalMinor - walletApplied,
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
        // Have Stripe generate a proper VAT invoice for this one-off card
        // purchase, using the account's business/VAT settings — the same source
        // that makes subscriber invoices VAT invoices. The batchOrderId on the
        // invoice metadata lets the invoice.paid webhook attach the PDF back to
        // this order. See docs/adr/0102-vat-receipts.md.
        invoice_creation: {
          enabled: true,
          invoice_data: { metadata: { batchOrderId: existing.id } },
        },
        success_url: `${webAppUrl}${successPath}?${successQuery.toString()}`,
        cancel_url: `${webAppUrl}${cancelPath}?batchOrderId=${existing.id}`,
        metadata: { batchOrderId: existing.id, accountId },
      });
    } catch (error) {
      // Compensating action: if we just claimed pending_payment for a draft, a
      // failed Stripe call must hand the draft back rather than leave the order
      // stuck in pending_payment with no Checkout Session behind it. A resume
      // was already pending_payment before this call, so leave it there —
      // reverting it to draft would be wrong, and it can simply be resumed again.
      if (movedFromDraft) {
        // Hand the reservation back first: the money must not sit debited
        // against an order that no longer has a live session behind it.
        await this.releaseWalletReservation(accountId, id);
        await this.prisma.batchOrder.updateMany({
          where: { id, accountId, status: "pending_payment" },
          data: { status: "draft" },
        });
      }
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
    // Before releasing the order: a pending_payment order may be holding a
    // reserved wallet draw, and cancelling without returning it would keep the
    // customer's money for a card that will never be printed. No-op when there
    // is nothing reserved.
    await this.releaseWalletReservation(accountId, id);
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

  /**
   * Repair an order whose cards were all dated one day, re-timing each to its
   * own recipient's occasion. Ops-only, one order at a time, run deliberately.
   *
   * Exists because ~76 cards were ordered before bulk sends learned to find
   * occasions server-side (#328) and every one landed dated today. `reschedule`
   * cannot fix it: it takes a single arrive-by for the whole order, and the
   * whole problem is that one shared date was applied to people with different
   * birthdays.
   *
   * Re-dating alone would be worse than the bug. Each recipient's natural
   * occasion is still sitting unconsumed, because reconciliation never ran — so
   * once the ordered card is moved onto the birthday, that birthday could ALSO
   * fire from approvals or auto-send and the recipient gets two cards. Each
   * repaired card therefore takes the superseding link its send should have had
   * and the natural occasion is marked `skipped`, exactly as settlement does for
   * a superseding one-off (ADR 0107).
   *
   * Guarded like `reschedule`: every card must still be `pending`. A card that
   * has been printed or posted has left the queue's control, and re-dating it
   * would describe something that already physically happened.
   *
   * Idempotent. A second run finds each card already carrying its superseding
   * link and reports it unchanged rather than searching for another occasion.
   */
  async redateToRecipientOccasions(
    actorUserId: string,
    batchOrderId: string,
  ): Promise<OccasionRedateSummary> {
    const summary = await this.prisma.$transaction(async (tx) => {
      const order = await tx.batchOrder.findUnique({
        where: { id: batchOrderId },
        include: {
          orderRecipients: {
            include: {
              recipient: { select: { firstName: true, lastName: true } },
              occasion: {
                select: { id: true, dispatchDate: true, postageClass: true, supersedesOccasionId: true },
              },
              fulfillmentJob: { select: { id: true, status: true } },
            },
          },
        },
      });
      if (!order) {
        throw new NotFoundException("Batch order not found");
      }
      if (order.status !== "paid" && order.status !== "fulfilling") {
        throw new ConflictException(
          `Only a paid order that hasn't posted can be re-dated (this one is "${order.status}").`,
        );
      }
      const started = order.orderRecipients.some(
        (line) => line.fulfillmentJob && line.fulfillmentJob.status !== "pending",
      );
      if (started) {
        throw new ConflictException(
          "Some cards are already being prepared, so this order can no longer be re-dated.",
        );
      }

      // One lookup for the whole order rather than per card.
      const alreadyRepaired = new Set(
        order.orderRecipients
          .filter((line) => line.occasion?.supersedesOccasionId)
          .map((line) => line.recipientId),
      );
      const candidates = order.orderRecipients
        .filter((line) => line.occasion && !alreadyRepaired.has(line.recipientId))
        .map((line) => line.recipientId);
      const natural = await this.findDatedOccasions(order.accountId, candidates);

      const cards: OccasionRedateCard[] = [];
      for (const line of order.orderRecipients) {
        const name = `${line.recipient.firstName} ${line.recipient.lastName}`.trim();
        const from = line.occasion?.dispatchDate ?? null;

        if (!line.occasion) {
          cards.push({ recipientName: name, from, to: null, outcome: "no-occasion" });
          continue;
        }
        if (line.occasion.supersedesOccasionId) {
          cards.push({ recipientName: name, from, to: from, outcome: "already-repaired" });
          continue;
        }
        const match = natural.get(line.recipientId);
        if (!match) {
          // Nothing dated to move it to — a genuine campaign card, or a
          // recipient with no birthday on file. Left exactly as it is.
          cards.push({ recipientName: name, from, to: from, outcome: "no-occasion" });
          continue;
        }

        const to = notBeforeToday(
          computeDispatchDate(match.occasionDate, POSTAGE_LEAD_DAYS[line.occasion.postageClass]),
        );
        await tx.occasion.update({
          where: { id: line.occasion.id },
          data: {
            dispatchDate: to,
            // The card is now *for* that birthday, so its occasion date has to
            // say so, not the day the order happened to be placed. This is the
            // field `{occasionDate}` / `{date}` print from — leave it behind and
            // a repaired card posts on the right day carrying the wrong date.
            occasionDate: match.occasionDate,
            supersedesOccasionId: match.occasionId,
          },
        });
        // Consume the natural occasion so it can't independently send a second
        // card on the same day. Status-guarded so an occasion that has since
        // moved on is never dragged back.
        await tx.occasion.updateMany({
          where: { id: match.occasionId, status: { in: [...RECONCILABLE_OCCASION_STATUSES] } },
          data: { status: "skipped" },
        });
        if (line.fulfillmentJob) {
          await tx.fulfillmentJob.update({
            where: { id: line.fulfillmentJob.id },
            data: { dueDate: to },
          });
        }
        cards.push({ recipientName: name, from, to, outcome: "redated" });
      }

      return {
        orderNumber: order.orderNumber,
        accountId: order.accountId,
        cards,
        redated: cards.filter((c) => c.outcome === "redated").length,
        unchanged: cards.filter((c) => c.outcome !== "redated").length,
      };
    });

    await this.audit.record({
      accountId: summary.accountId,
      actorUserId,
      action: "redate_to_occasions",
      targetType: "BatchOrder",
      targetId: batchOrderId,
      metadata: { redated: summary.redated, unchanged: summary.unchanged },
    });
    return summary;
  }

  /**
   * Reschedule a paid, not-yet-posted order to a new arrive-by date. Recomputes
   * each card's post-by date (its occasion's dispatchDate) and the denormalised
   * FulfillmentJob.dueDate from the chosen date, using the same lead engine as
   * creation. Only allowed while every card is still `pending` (or not yet
   * queued) — once anything is in progress/printed/posted the schedule is fixed.
   * Payment is unchanged; this only moves *when* it posts. See ADR 0130.
   */
  async reschedule(
    accountId: string,
    actorUserId: string,
    id: string,
    deliverBy: string,
  ): Promise<BatchOrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.batchOrder.findFirst({
        where: { id, accountId },
        include: {
          orderRecipients: {
            include: {
              occasion: { select: { id: true, source: true, postageClass: true } },
              fulfillmentJob: { select: { id: true, status: true } },
            },
          },
        },
      });
      if (!order) {
        throw new NotFoundException("Batch order not found");
      }
      if (order.status !== "paid" && order.status !== "fulfilling") {
        throw new ConflictException(
          `Only a paid order that hasn't posted can be rescheduled (this one is "${order.status}").`,
        );
      }
      // Every card must still be un-actioned. A job that's moved past `pending`
      // (in progress / printed / posted / …) has left the queue's control.
      const started = order.orderRecipients.some(
        (r) => r.fulfillmentJob && r.fulfillmentJob.status !== "pending",
      );
      if (started) {
        throw new ConflictException(
          "Some cards are already being prepared, so this order can no longer be rescheduled.",
        );
      }

      for (const line of order.orderRecipients) {
        if (!line.occasion) continue;
        const schedule = this.resolveSendSchedule(deliverBy, line.occasion.postageClass);
        await tx.occasion.update({
          where: { id: line.occasion.id },
          data: {
            dispatchDate: schedule.dispatchDate,
            // A bespoke one-off's occasionDate *is* the arrive-by date; a reused
            // natural occasion (a birthday) keeps its own date — only its post-by
            // date moves. Mirrors bulkSend/quickSend.
            ...(line.occasion.source === "one_off_campaign" && {
              occasionDate: schedule.occasionDate,
            }),
          },
        });
        if (line.fulfillmentJob) {
          await tx.fulfillmentJob.update({
            where: { id: line.fulfillmentJob.id },
            data: { dueDate: schedule.dispatchDate },
          });
        }
      }
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "reschedule",
      targetType: "BatchOrder",
      targetId: id,
      metadata: { deliverBy },
    });
    return this.findOne(accountId, actorUserId, id);
  }

  /**
   * Self-serve cancel-with-refund for a paid, not-yet-posted order — the
   * customer's own "Cancel & refund" on a scheduled order. Refunds the full
   * amount to wherever they paid from (Stripe for card, the wallet ledger for
   * wallet), then releases the order: drops its pending print jobs, marks each
   * card cancelled, skips its occasion, and sets the order `cancelled`.
   *
   * Only allowed while EVERY card is still `pending` — once anything is in
   * progress / printed / posted the money is committed to physical work and the
   * customer is routed to support instead. This is the platform's first
   * automated refund (previously deferred by ADR 0008); see ADR 0131.
   *
   * The card path refunds FIRST, keyed on the order id so Stripe collapses any
   * retry onto one refund (never a double refund), then claims the DB state —
   * so the worst case is "refunded but not yet released", which self-heals on
   * retry, never "released but silently unrefunded". The wallet path does it all
   * in one Serializable transaction (the credit is just a ledger row).
   */
  async cancelAndRefund(accountId: string, actorUserId: string, id: string): Promise<BatchOrder> {
    const order = await this.prisma.batchOrder.findFirst({
      where: { id, accountId },
      include: {
        orderRecipients: {
          select: { id: true, fulfillmentJob: { select: { status: true } } },
        },
      },
    });
    if (!order) {
      throw new NotFoundException("Batch order not found");
    }
    if (order.status !== "paid" && order.status !== "fulfilling") {
      throw new ConflictException(
        `Only a paid order that hasn't posted can be cancelled for a refund (this one is "${order.status}").`,
      );
    }
    // Every card must still be un-actioned. A job past `pending` (in progress /
    // printed / posted / …) means real work has begun — self-serve refund stops
    // here and the customer is pointed at support.
    const started = order.orderRecipients.some(
      (r) => r.fulfillmentJob && r.fulfillmentJob.status !== "pending",
    );
    if (started) {
      throw new ConflictException(
        "Some cards are already being prepared, so this order can no longer be cancelled online — please contact support.",
      );
    }

    if (order.paymentMethod === "wallet") {
      await this.refundWalletAndRelease(accountId, id, order.totalMinor);
    } else if (order.walletAppliedMinor > 0) {
      // A split order: Stripe took the remainder and the wallet took the rest,
      // so both have to come back. The Stripe refund goes first — it is the leg
      // that can fail, and it is idempotency-keyed, so a retry after a partial
      // failure re-attempts the same single refund rather than double-crediting
      // the wallet.
      await this.refundCardAndRelease(accountId, id, order.stripePaymentIntentId);
      await this.creditWalletPortion(accountId, id, order.walletAppliedMinor);
    } else {
      await this.refundCardAndRelease(accountId, id, order.stripePaymentIntentId);
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "cancel_refund",
      targetType: "BatchOrder",
      targetId: id,
      metadata: { totalMinor: order.totalMinor, paymentMethod: order.paymentMethod },
    });

    return this.prisma.batchOrder.findUniqueOrThrow({
      where: { id },
      include: ORDER_RECIPIENTS_INCLUDE,
    });
  }

  /** Card refund: issue the Stripe refund (idempotency-keyed on the order id so a
   * retry / concurrent double-submit can only ever produce one refund), THEN
   * release the order state under a status guard. See cancelAndRefund + ADR 0131. */
  private async refundCardAndRelease(
    accountId: string,
    id: string,
    paymentIntentId: string | null,
  ): Promise<void> {
    if (!paymentIntentId) {
      throw new ConflictException(
        "This order has no card payment on record to refund — please contact support.",
      );
    }
    await this.stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `refund:${id}` },
    );

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.batchOrder.updateMany({
        where: { id, accountId, status: { in: ["paid", "fulfilling"] } },
        data: { status: "cancelled" },
      });
      // count === 0 → a concurrent request already released this order; by the
      // shared idempotency key it shares the same single refund, so there is
      // nothing more to do.
      if (count > 0) {
        await this.releaseRecipientsAndOccasions(tx, id, accountId);
      }
    });
  }

  /**
   * The smallest charge Stripe will take in GBP. A split that would leave less
   * than this on the card is impossible to put through, so the wallet draw is
   * reduced to leave exactly this much rather than failing the checkout.
   */
  private static readonly STRIPE_MINIMUM_CHARGE_MINOR = 30;

  /** Balance = sum of all ledger amounts, the same definition WalletService
   *  uses. Order-independent, so it can't drift from the ledger. */
  private async walletBalance(
    tx: Prisma.TransactionClient,
    accountId: string,
  ): Promise<number> {
    const { _sum } = await tx.walletLedgerEntry.aggregate({
      where: { accountId },
      _sum: { amountMinor: true },
    });
    return _sum.amountMinor ?? 0;
  }

  /**
   * How much of `totalMinor` this balance should pay, leaving a card charge
   * Stripe will actually accept.
   *
   * Covering the whole order is the caller's cue to skip Stripe entirely. Below
   * that, the wallet pays as much as it can — except where the leftover would
   * fall under Stripe's minimum, when the draw is trimmed so the card is charged
   * exactly the minimum. Pure, so the arithmetic can be tested without a
   * database.
   */
  static walletDrawFor(balanceMinor: number, totalMinor: number): number {
    if (balanceMinor <= 0) return 0;
    if (balanceMinor >= totalMinor) return totalMinor;
    const remainder = totalMinor - balanceMinor;
    if (remainder >= BatchOrdersService.STRIPE_MINIMUM_CHARGE_MINOR) return balanceMinor;
    return Math.max(0, totalMinor - BatchOrdersService.STRIPE_MINIMUM_CHARGE_MINOR);
  }

  /**
   * Hand a reserved wallet amount back, because the payment it was reserved for
   * will never complete — the Stripe call failed, the session expired, or the
   * buyer cancelled.
   *
   * Idempotent by construction: zeroing `walletAppliedMinor` is a
   * compare-and-swap, so only the request that actually claims the reservation
   * writes the credit. Every abandon path calls this, and missing one would
   * quietly keep a customer's money.
   */
  async releaseWalletReservation(accountId: string, batchOrderId: string): Promise<void> {
    await runSerializable(this.prisma, async (tx) => {
      const order = await tx.batchOrder.findFirst({
        where: { id: batchOrderId, accountId },
        select: { walletAppliedMinor: true },
      });
      if (!order || order.walletAppliedMinor <= 0) {
        return; // nothing reserved, or another request already released it
      }
      const reserved = order.walletAppliedMinor;
      // Compare-and-swap on the exact amount, so the credit below is written by
      // whichever request actually claimed the reservation and by no other.
      const { count } = await tx.batchOrder.updateMany({
        where: { id: batchOrderId, accountId, walletAppliedMinor: reserved },
        data: { walletAppliedMinor: 0 },
      });
      if (count === 0) {
        return;
      }
      const balance = await this.walletBalance(tx, accountId);
      await tx.walletLedgerEntry.create({
        data: {
          accountId,
          type: "refund",
          amountMinor: reserved,
          balanceAfterMinor: balance + reserved,
          reference: `release:${batchOrderId}`,
        },
      });
    });
  }

  /**
   * The wallet half of a split order's refund.
   *
   * Separate from `refundWalletAndRelease` because the order has already been
   * released by the Stripe leg — this only puts the money back. Idempotent on
   * the reference, so a retried refund credits once.
   */
  private async creditWalletPortion(
    accountId: string,
    id: string,
    walletAppliedMinor: number,
  ): Promise<void> {
    await runSerializable(this.prisma, async (tx) => {
      const reference = `refund:${id}:wallet`;
      const existing = await tx.walletLedgerEntry.findFirst({ where: { accountId, reference } });
      if (existing) return;
      const balance = await this.walletBalance(tx, accountId);
      await tx.walletLedgerEntry.create({
        data: {
          accountId,
          type: "refund",
          amountMinor: walletAppliedMinor,
          balanceAfterMinor: balance + walletAppliedMinor,
          reference,
        },
      });
    });
  }

  /** Wallet refund: claim the order and write the `refund` ledger credit in one
   * Serializable transaction. The status-guarded claim is the idempotency guard —
   * only the winner writes the credit, so concurrent submits can't double-refund. */
  private async refundWalletAndRelease(
    accountId: string,
    id: string,
    totalMinor: number,
  ): Promise<void> {
    await runSerializable(this.prisma, async (tx) => {
      const { count } = await tx.batchOrder.updateMany({
        where: { id, accountId, status: { in: ["paid", "fulfilling"] } },
        data: { status: "cancelled" },
      });
      if (count === 0) {
        // Already released by a concurrent request, which wrote the single refund
        // entry — writing another here would double-credit the wallet.
        return;
      }
      const { _sum } = await tx.walletLedgerEntry.aggregate({
        where: { accountId },
        _sum: { amountMinor: true },
      });
      const balance = _sum.amountMinor ?? 0;
      await tx.walletLedgerEntry.create({
        data: {
          accountId,
          type: "refund",
          amountMinor: totalMinor,
          balanceAfterMinor: balance + totalMinor,
          reference: `refund:${id}`,
        },
      });
      await this.releaseRecipientsAndOccasions(tx, id, accountId);
    });
  }

  /** Shared release once a refund is committed: drop the pending print jobs
   * (nothing will be posted now), mark every card `cancelled`, and skip each
   * settled occasion so it never re-triggers a send. */
  private async releaseRecipientsAndOccasions(
    tx: Prisma.TransactionClient,
    batchOrderId: string,
    accountId: string,
  ): Promise<void> {
    const orderRecipients = await tx.orderRecipient.findMany({
      where: { batchOrderId },
      select: { id: true, occasionId: true },
    });
    const orderRecipientIds = orderRecipients.map((r) => r.id);
    const occasionIds = orderRecipients
      .map((r) => r.occasionId)
      .filter((occasionId): occasionId is string => occasionId !== null);

    await tx.fulfillmentJob.deleteMany({
      where: { orderRecipientId: { in: orderRecipientIds }, status: "pending" },
    });
    await tx.orderRecipient.updateMany({
      where: { batchOrderId },
      data: { status: "cancelled" },
    });
    if (occasionIds.length > 0) {
      // Guard on `queued` — a settled order's occasions sit there (create() moves
      // approved → queued at checkout). Guarding avoids clobbering any occasion
      // that has somehow moved on independently.
      await tx.occasion.updateMany({
        where: { id: { in: occasionIds }, accountId, status: "queued" },
        data: { status: "skipped" },
      });
    }
  }
}
