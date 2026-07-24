import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type ReturnCaseStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BatchOrdersService } from "../batch-orders/batch-orders.service";
import { NotificationInboxService } from "../notifications/notification-inbox.service";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { renderBrandedEmail, escapeHtml } from "../email/email-layout";
import { generateRtsToken } from "../common/generate-rts-token";
import type { EnvConfig } from "../config/env.schema";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";
import type { MarkReturnedDto } from "./dto/mark-returned.dto";
import type { RecoveryAddressDto } from "./dto/recovery-address.dto";
import type { ListReturnsQueryDto } from "./dto/list-returns-query.dto";

/** Platform-configurable window (in days) after an occasion date within which a
 * returned card can still be resent to the recipient in time. Past it, the
 * birthday's "already passed" — resend-to-recipient is blocked and only
 * send-to-business / archive remain. Overridable via the PlatformSetting store. */
const BIRTHDAY_PASSED_DAYS_KEY = "rts_birthday_passed_days";
const BIRTHDAY_PASSED_DAYS_DEFAULT = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Audit actor for actions taken via the no-login email link — no human user id
 * is available, so this mirrors the SYSTEM_ACTOR convention used elsewhere. */
const PUBLIC_RTS_ACTOR = "public:rts-link";

/** Statuses a card can be marked returned *from* — it must actually have been
 * sent. A pending/printed card hasn't left us; a returned/cancelled one is done. */
const RETURNABLE_JOB_STATUSES = ["posted", "delivered"] as const;

/** The full graph a case needs for views, recovery, and notifications. */
const CASE_INCLUDE = {
  recipient: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressPostcode: true,
      addressCountry: true,
    },
  },
  orderRecipient: {
    select: {
      id: true,
      savedDesignId: true,
      occasionId: true,
      postageClass: true,
      batchOrder: { select: { orderNumber: true, accountId: true } },
      occasion: { select: { type: true, title: true, occasionDate: true } },
    },
  },
} satisfies Prisma.ReturnCaseInclude;

type CaseWithGraph = Prisma.ReturnCaseGetPayload<{ include: typeof CASE_INCLUDE }>;

/** The customer-facing view of a return case, including whether an in-time
 * resend to the recipient is still possible (the birthday-passed logic). */
export interface ReturnCaseView {
  id: string;
  orderNumber: number;
  recipientId: string;
  recipientName: string;
  occasionType: string | null;
  occasionTitle: string | null;
  occasionDate: Date | null;
  reason: string;
  status: ReturnCaseStatus;
  freeRecoveryUsed: boolean;
  addressUpdatedAt: Date | null;
  resolvedAt: Date | null;
  resolution: string | null;
  returnedAt: Date;
  /** Resend eligibility, so the UI can offer the right options. */
  resend: {
    /** Address on file is complete enough to resend to the recipient. */
    hasRecipientAddress: boolean;
    /** The occasion date has passed by more than the configured window. */
    birthdayPassed: boolean;
    /** Whole days since the occasion date (negative if still upcoming; null when
     * the returned card has no dated occasion). */
    daysSinceOccasion: number | null;
  };
}

/** The ops RTS-queue row — the columns the queue needs, no street address. */
export interface RtsQueueItem {
  id: string;
  accountId: string;
  businessName: string;
  recipientName: string;
  occasionType: string | null;
  occasionDate: Date | null;
  reason: string;
  status: ReturnCaseStatus;
  freeRecoveryUsed: boolean;
  returnedAt: Date;
  daysSinceReturn: number;
  awaitingAddress: boolean;
  awaitingResend: boolean;
  archived: boolean;
}

/**
 * The Returned to Sender (RTS) service-recovery workflow. When Royal Mail sends
 * a card back, ops marks it returned; that flags the contact
 * (addressVerificationRequired), pauses automatic sends to them, opens a
 * ReturnCase, and emails the customer to update the address. The customer then
 * recovers the card **once, free** (the Kudos Promise) — resent to the corrected
 * address or hand-delivered to their business — or archives it. See
 * docs/adr/0039-returned-to-sender.md.
 */
@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly batchOrders: BatchOrdersService,
    private readonly inbox: NotificationInboxService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
  ) {}

  // -------------------------------------------------------------------------
  // Ops
  // -------------------------------------------------------------------------

  /**
   * Ops marks a posted/delivered card Returned to Sender: the fulfillment job
   * and order line move to `returned_to_sender`, the contact is flagged for
   * address verification (which pauses their automatic sends), and a ReturnCase
   * opens in `awaiting_address`. After commit, the customer is emailed and an
   * inbox item is fanned out. Idempotent per card — a second mark is a 409.
   */
  async markReturned(actorUserId: string, dto: MarkReturnedDto): Promise<ReturnCaseView> {
    const caseId = await this.prisma.$transaction(async (tx) => {
      const job = await tx.fulfillmentJob.findUnique({
        where: { id: dto.fulfillmentJobId },
        select: {
          id: true,
          status: true,
          orderRecipient: {
            select: {
              id: true,
              recipientId: true,
              batchOrder: { select: { accountId: true } },
              returnCase: { select: { id: true } },
            },
          },
        },
      });
      if (!job) {
        throw new NotFoundException("Fulfillment job not found");
      }
      if (job.orderRecipient.returnCase) {
        throw new ConflictException("This card is already marked returned");
      }
      if (!RETURNABLE_JOB_STATUSES.includes(job.status as (typeof RETURNABLE_JOB_STATUSES)[number])) {
        throw new ConflictException(
          `Only a posted or delivered card can be marked returned (this one is "${job.status}")`,
        );
      }

      const { accountId } = job.orderRecipient.batchOrder;
      const { recipientId, id: orderRecipientId } = job.orderRecipient;

      // Status-guarded so a concurrent transition can't race the return.
      const moved = await tx.fulfillmentJob.updateMany({
        where: { id: job.id, status: { in: [...RETURNABLE_JOB_STATUSES] } },
        data: { status: "returned_to_sender" },
      });
      if (moved.count === 0) {
        throw new ConflictException("The card's status changed — please retry");
      }
      await tx.orderRecipient.update({
        where: { id: orderRecipientId },
        data: { status: "returned_to_sender" },
      });
      await tx.recipient.update({
        where: { id: recipientId },
        data: { addressVerificationRequired: true },
      });

      const created = await tx.returnCase.create({
        data: {
          accountId,
          orderRecipientId,
          recipientId,
          reason: dto.reason,
          status: "awaiting_address",
          markedByUserId: actorUserId,
          // The secret that authorises the self-serve email link (no login).
          publicToken: generateRtsToken(),
        },
      });

      await this.audit.record(
        {
          accountId,
          actorUserId,
          action: "card_returned_to_sender",
          targetType: "ReturnCase",
          targetId: created.id,
          metadata: { fulfillmentJobId: job.id, orderRecipientId, reason: dto.reason },
        },
        tx,
      );
      return { caseId: created.id, accountId, publicToken: created.publicToken };
    });

    const view = await this.loadView(caseId.caseId);
    // Best-effort, post-commit: tell the customer their card came back.
    await this.notifyReturned(view, caseId.accountId, caseId.publicToken);
    return view;
  }

  /** The cross-account RTS queue for ops. Defaults to open cases
   * (awaiting_address + awaiting_resend), oldest return first. */
  async listQueue(query: ListReturnsQueryDto): Promise<Paginated<RtsQueueItem>> {
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 50);

    const where: Prisma.ReturnCaseWhereInput =
      !query.status || query.status === "open"
        ? { status: { in: ["awaiting_address", "awaiting_resend"] } }
        : { status: query.status };

    const items = await this.prisma.returnCase.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: [{ returnedAt: "asc" }],
      include: {
        recipient: { select: { firstName: true, lastName: true } },
        account: { select: { name: true } },
        orderRecipient: {
          select: { occasion: { select: { type: true, occasionDate: true } } },
        },
      },
    });
    const total = await this.prisma.returnCase.count({ where });

    const now = Date.now();
    return {
      items: items.map((c) => ({
        id: c.id,
        accountId: c.accountId,
        businessName: c.account.name,
        recipientName: `${c.recipient.firstName} ${c.recipient.lastName}`,
        occasionType: c.orderRecipient.occasion?.type ?? null,
        occasionDate: c.orderRecipient.occasion?.occasionDate ?? null,
        reason: c.reason,
        status: c.status,
        freeRecoveryUsed: c.freeRecoveryUsed,
        returnedAt: c.returnedAt,
        daysSinceReturn: Math.floor((now - c.returnedAt.getTime()) / MS_PER_DAY),
        awaitingAddress: c.status === "awaiting_address",
        awaitingResend: c.status === "awaiting_resend",
        archived: c.status === "archived",
      })),
      total,
      page,
      perPage,
    };
  }

  // -------------------------------------------------------------------------
  // Customer
  // -------------------------------------------------------------------------

  /** The account's return cases (open first, newest first) — drives the contact
   * alerts and the returns list in the app. */
  async listForAccount(accountId: string): Promise<ReturnCaseView[]> {
    const cases = await this.prisma.returnCase.findMany({
      where: { accountId },
      orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { returnedAt: "desc" }],
      include: CASE_INCLUDE,
    });
    const thresholdDays = await this.resolveBirthdayPassedDays();
    return cases.map((c) => this.toView(c, thresholdDays));
  }

  async getForAccount(accountId: string, id: string): Promise<ReturnCaseView> {
    const found = await this.prisma.returnCase.findFirst({
      where: { id, accountId },
      include: CASE_INCLUDE,
    });
    if (!found) {
      throw new NotFoundException("Return case not found");
    }
    return this.toView(found, await this.resolveBirthdayPassedDays());
  }

  /**
   * The customer updates the contact's address after a return. Writes it to the
   * recipient and advances the case to `awaiting_resend` so they can choose a
   * recovery. The address-verification flag stays set until the case is resolved
   * (a resend/hand-deliver/archive) so automatic sends stay paused meanwhile.
   */
  async updateAddress(
    accountId: string,
    actorUserId: string,
    id: string,
    dto: RecoveryAddressDto,
  ): Promise<ReturnCaseView> {
    const found = await this.requireCase(accountId, id, ["awaiting_address", "awaiting_resend"]);

    await this.prisma.$transaction(async (tx) => {
      await tx.recipient.update({
        where: { id: found.recipientId },
        data: {
          addressLine1: dto.addressLine1,
          addressLine2: dto.addressLine2 ?? null,
          addressCity: dto.addressCity,
          addressPostcode: dto.addressPostcode,
          addressCountry: dto.addressCountry ?? "GB",
        },
      });
      await tx.returnCase.update({
        where: { id },
        data: { status: "awaiting_resend", addressUpdatedAt: new Date() },
      });
      await this.audit.record(
        {
          accountId,
          actorUserId,
          action: "return_address_updated",
          targetType: "ReturnCase",
          targetId: id,
        },
        tx,
      );
    });
    return this.getForAccount(accountId, id);
  }

  /**
   * Option A — resend the card, free, to the corrected recipient address (the one
   * Kudos Promise recovery). Requires the address to have been updated and the
   * occasion not to have passed the configured window. Consumes the free
   * recovery, resolves the case, and clears the contact flag (if no other case
   * still holds it).
   */
  async resendToRecipient(
    accountId: string,
    actorUserId: string,
    id: string,
  ): Promise<ReturnCaseView> {
    const found = await this.requireCase(accountId, id, ["awaiting_resend"]);
    const r = found.recipient;
    if (!r.addressLine1 || !r.addressCity || !r.addressPostcode) {
      throw new ConflictException("Update the contact's address before resending");
    }
    const thresholdDays = await this.resolveBirthdayPassedDays();
    if (this.birthdayPassed(found.orderRecipient.occasion?.occasionDate ?? null, thresholdDays)) {
      throw new ConflictException(
        "This birthday has already passed — send the original card to your business or archive it instead",
      );
    }

    return this.recoverOnce(accountId, actorUserId, found, "resend_recipient", {
      line1: r.addressLine1,
      line2: r.addressLine2,
      city: r.addressCity,
      postcode: r.addressPostcode,
      country: r.addressCountry ?? "GB",
    });
  }

  /**
   * Option B — send the returned card, free, to the business address for hand
   * delivery (the one Kudos Promise recovery). Available regardless of the
   * birthday date, since it's delivering the card already made. */
  async sendToBusiness(
    accountId: string,
    actorUserId: string,
    id: string,
    dto: RecoveryAddressDto,
  ): Promise<ReturnCaseView> {
    const found = await this.requireCase(accountId, id, ["awaiting_address", "awaiting_resend"]);
    return this.recoverOnce(accountId, actorUserId, found, "send_business", {
      line1: dto.addressLine1,
      line2: dto.addressLine2 ?? null,
      city: dto.addressCity,
      postcode: dto.addressPostcode,
      country: dto.addressCountry ?? "GB",
    });
  }

  /** Archive a case — the customer decides not to recover this card. Resolves it
   * and clears the contact flag (if no other case holds it) so sends resume. */
  async archive(accountId: string, actorUserId: string, id: string): Promise<ReturnCaseView> {
    const found = await this.requireCase(accountId, id, ["awaiting_address", "awaiting_resend"]);
    await this.prisma.$transaction(async (tx) => {
      const closed = await tx.returnCase.updateMany({
        where: { id, status: { in: ["awaiting_address", "awaiting_resend"] } },
        data: { status: "archived", resolvedAt: new Date(), resolution: "archived" },
      });
      if (closed.count === 0) {
        throw new ConflictException("This return has already been resolved");
      }
      await this.clearFlagIfLastOpenCase(tx, found.recipientId, id);
      await this.audit.record(
        { accountId, actorUserId, action: "return_archived", targetType: "ReturnCase", targetId: id },
        tx,
      );
    });
    return this.getForAccount(accountId, id);
  }

  // -------------------------------------------------------------------------
  // Public self-serve (email link, no login) — token-gated. Each method
  // resolves the token to (accountId, caseId) then delegates to the
  // account-scoped method above, so the whole recovery flow — including the
  // one-free-recovery guard and birthday logic — is shared, not duplicated.
  // See docs/adr/0039-returned-to-sender.md.
  // -------------------------------------------------------------------------

  async getByToken(token: string): Promise<ReturnCaseView> {
    const { accountId, id } = await this.resolveToken(token);
    return this.getForAccount(accountId, id);
  }

  async updateAddressByToken(token: string, dto: RecoveryAddressDto): Promise<ReturnCaseView> {
    const { accountId, id } = await this.resolveToken(token);
    return this.updateAddress(accountId, PUBLIC_RTS_ACTOR, id, dto);
  }

  async resendByToken(token: string): Promise<ReturnCaseView> {
    const { accountId, id } = await this.resolveToken(token);
    return this.resendToRecipient(accountId, PUBLIC_RTS_ACTOR, id);
  }

  async sendToBusinessByToken(token: string, dto: RecoveryAddressDto): Promise<ReturnCaseView> {
    const { accountId, id } = await this.resolveToken(token);
    return this.sendToBusiness(accountId, PUBLIC_RTS_ACTOR, id, dto);
  }

  async archiveByToken(token: string): Promise<ReturnCaseView> {
    const { accountId, id } = await this.resolveToken(token);
    return this.archive(accountId, PUBLIC_RTS_ACTOR, id);
  }

  /** Resolve the email-link token to its case. A bad/expired token is a 404 —
   * the same response as an unknown case, so nothing is leaked about validity. */
  private async resolveToken(token: string): Promise<{ accountId: string; id: string }> {
    const found = await this.prisma.returnCase.findFirst({
      where: { publicToken: token },
      select: { id: true, accountId: true },
    });
    if (!found) {
      throw new NotFoundException("This link is invalid or has expired");
    }
    return found;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Creates the single free (£0) recovery order for a case and resolves it. The
   * case update is status-guarded on `freeRecoveryUsed = false`, so two clicks
   * can't produce two free cards. */
  private async recoverOnce(
    accountId: string,
    actorUserId: string,
    found: CaseWithGraph,
    resolution: "resend_recipient" | "send_business",
    address: { line1: string; line2: string | null; city: string; postcode: string; country: string },
  ): Promise<ReturnCaseView> {
    if (found.freeRecoveryUsed) {
      throw new ConflictException(
        "The free recovery for this card has been used — place a new order to send another",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Claim the free recovery first (status-guarded); if another request beat
      // us to it, count is 0 and we abort before creating a second free order.
      const claimed = await tx.returnCase.updateMany({
        where: { id: found.id, freeRecoveryUsed: false, status: "awaiting_resend" },
        data: { freeRecoveryUsed: true, status: "resolved", resolvedAt: new Date(), resolution },
      });
      if (claimed.count === 0) {
        // send_business is allowed from awaiting_address too — retry that case.
        const claimedEarly = await tx.returnCase.updateMany({
          where: {
            id: found.id,
            freeRecoveryUsed: false,
            status: "awaiting_address",
          },
          data: { freeRecoveryUsed: true, status: "resolved", resolvedAt: new Date(), resolution },
        });
        if (claimedEarly.count === 0) {
          throw new ConflictException("This return has already been recovered");
        }
      }

      const order = await tx.batchOrder.create({
        data: {
          accountId,
          createdByUserId: actorUserId,
          status: "paid",
          subtotalMinor: 0,
          postageMinor: 0,
          totalMinor: 0,
        },
      });
      await tx.orderRecipient.create({
        data: {
          batchOrderId: order.id,
          recipientId: found.recipientId,
          occasionId: found.orderRecipient.occasionId,
          savedDesignId: found.orderRecipient.savedDesignId,
          shippingAddressLine1: address.line1,
          shippingAddressLine2: address.line2,
          shippingAddressCity: address.city,
          shippingAddressPostcode: address.postcode,
          shippingAddressCountry: address.country,
          dispatchOption: "asap",
          postageClass: found.orderRecipient.postageClass,
          priceMinor: 0,
          postageMinor: 0,
          status: "approved",
        },
      });
      // Reuse the shared post-payment step: queue the line, create the
      // fulfillment job, mint the QR message page.
      await this.batchOrders.settleFulfillment(tx, order.id);

      await tx.returnCase.update({ where: { id: found.id }, data: { recoveryOrderId: order.id } });
      await this.clearFlagIfLastOpenCase(tx, found.recipientId, found.id);

      await this.audit.record(
        {
          accountId,
          actorUserId,
          action: "return_recovered",
          targetType: "ReturnCase",
          targetId: found.id,
          metadata: { resolution, recoveryOrderId: order.id },
        },
        tx,
      );
    });

    await this.notifyRecovered(accountId, found, resolution);
    return this.getForAccount(accountId, found.id);
  }

  /** Clear the contact's address-verification flag once no other open case still
   * needs it — so recovering one returned card doesn't un-pause a contact that
   * has another return still outstanding. */
  private async clearFlagIfLastOpenCase(
    tx: Prisma.TransactionClient,
    recipientId: string,
    excludeCaseId: string,
  ): Promise<void> {
    const otherOpen = await tx.returnCase.count({
      where: {
        recipientId,
        id: { not: excludeCaseId },
        status: { in: ["awaiting_address", "awaiting_resend"] },
      },
    });
    if (otherOpen === 0) {
      await tx.recipient.update({
        where: { id: recipientId },
        data: { addressVerificationRequired: false },
      });
    }
  }

  private async requireCase(
    accountId: string,
    id: string,
    allowed: ReturnCaseStatus[],
  ): Promise<CaseWithGraph> {
    const found = await this.prisma.returnCase.findFirst({
      where: { id, accountId },
      include: CASE_INCLUDE,
    });
    if (!found) {
      throw new NotFoundException("Return case not found");
    }
    if (!allowed.includes(found.status)) {
      throw new ConflictException(`This return is "${found.status}" and can't take that action`);
    }
    return found;
  }

  private async loadView(id: string): Promise<ReturnCaseView> {
    const found = await this.prisma.returnCase.findUniqueOrThrow({
      where: { id },
      include: CASE_INCLUDE,
    });
    return this.toView(found, await this.resolveBirthdayPassedDays());
  }

  private toView(c: CaseWithGraph, thresholdDays: number): ReturnCaseView {
    const occasionDate = c.orderRecipient.occasion?.occasionDate ?? null;
    const r = c.recipient;
    return {
      id: c.id,
      orderNumber: c.orderRecipient.batchOrder.orderNumber,
      recipientId: c.recipientId,
      recipientName: `${r.firstName} ${r.lastName}`,
      occasionType: c.orderRecipient.occasion?.type ?? null,
      occasionTitle: c.orderRecipient.occasion?.title ?? null,
      occasionDate,
      reason: c.reason,
      status: c.status,
      freeRecoveryUsed: c.freeRecoveryUsed,
      addressUpdatedAt: c.addressUpdatedAt,
      resolvedAt: c.resolvedAt,
      resolution: c.resolution,
      returnedAt: c.returnedAt,
      resend: {
        hasRecipientAddress: Boolean(r.addressLine1 && r.addressCity && r.addressPostcode),
        birthdayPassed: this.birthdayPassed(occasionDate, thresholdDays),
        daysSinceOccasion: this.daysSince(occasionDate),
      },
    };
  }

  private daysSince(date: Date | null): number | null {
    if (!date) return null;
    const today = this.startOfUtcToday();
    return Math.floor((today.getTime() - this.startOfUtcDay(date).getTime()) / MS_PER_DAY);
  }

  private birthdayPassed(occasionDate: Date | null, thresholdDays: number): boolean {
    const days = this.daysSince(occasionDate);
    return days !== null && days > thresholdDays;
  }

  private startOfUtcToday(): Date {
    return this.startOfUtcDay(new Date());
  }

  private startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private async resolveBirthdayPassedDays(): Promise<number> {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: BIRTHDAY_PASSED_DAYS_KEY },
    });
    const parsed = row ? Number.parseInt(row.value, 10) : NaN;
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : BIRTHDAY_PASSED_DAYS_DEFAULT;
  }

  // -------------------------------------------------------------------------
  // Notifications (best-effort — never fail the workflow they observe)
  // -------------------------------------------------------------------------

  private async notifyReturned(
    view: ReturnCaseView,
    accountId: string,
    publicToken: string | null,
  ): Promise<void> {
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    // The email link is the self-serve, no-login recovery page (token-gated).
    // Fall back to the in-app contact record if a token somehow isn't set.
    const contactUrl = publicToken
      ? `${webAppUrl}/rts/${publicToken}`
      : `${webAppUrl}/recipients/${view.recipientId}`;
    try {
      await this.inbox.notifyAccount(accountId, {
        kind: "card_returned",
        title: `A card to ${view.recipientName} was returned`,
        body: "Royal Mail returned it undelivered. Update the address to send it again.",
        href: `/recipients/${view.recipientId}`,
        entityType: "ReturnCase",
        entityId: view.id,
      });
    } catch (error) {
      this.logger.error(`RTS inbox notify for case ${view.id} failed: ${this.reason(error)}`);
    }
    try {
      const email = await this.resolveAccountEmail(accountId);
      if (!email) return;
      await this.email.sendTransactional({
        to: email,
        subject: `We couldn't deliver a card to ${view.recipientName}`,
        templateId: this.config.get("BREVO_RTS_TEMPLATE_ID", { infer: true }),
        params: {
          recipientName: view.recipientName,
          contactUrl,
        },
        html: renderBrandedEmail({
          webAppUrl,
          preheader: `A card to ${view.recipientName} was returned — please update the address.`,
          heading: "A card was returned to us ✉️",
          bodyHtml: `
            <p style="margin:0 0 16px">We were unable to deliver a card to
              <strong>${escapeHtml(view.recipientName)}</strong> because Royal Mail returned it to us.</p>
            <p style="margin:0 0 16px">Please update the recipient's address before any future cards are
              sent. As part of our Kudos Promise, we'll resend this card <strong>free of charge</strong>
              once the address is corrected.</p>`,
          cta: { url: contactUrl, label: "Update address" },
        }),
      });
    } catch (error) {
      this.logger.error(`RTS email for case ${view.id} failed: ${this.reason(error)}`);
    }
  }

  private async notifyRecovered(
    accountId: string,
    found: CaseWithGraph,
    resolution: "resend_recipient" | "send_business",
  ): Promise<void> {
    const name = `${found.recipient.firstName} ${found.recipient.lastName}`;
    const where = resolution === "send_business" ? "your business address" : "the corrected address";
    try {
      await this.inbox.notifyAccount(accountId, {
        kind: "card_returned",
        title: `${name}'s card is on its way again`,
        body: `We're resending it free to ${where} — that's your Kudos Promise recovery used.`,
        href: "/orders",
        entityType: "ReturnCaseRecovery",
        entityId: found.id,
      });
    } catch (error) {
      this.logger.error(`RTS recovery notify for case ${found.id} failed: ${this.reason(error)}`);
    }
  }

  /** The customer's email: the guest contact email if set, else the account
   * owner's membership email, else any member's. */
  private async resolveAccountEmail(accountId: string): Promise<string | null> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { contactEmail: true },
    });
    if (account?.contactEmail) return account.contactEmail;
    const members = await this.prisma.membership.findMany({
      where: { accountId, email: { not: null } },
      select: { email: true, role: true },
    });
    const owner = members.find((m) => m.role === "owner");
    return owner?.email ?? members[0]?.email ?? null;
  }

  private reason(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
  }
}
