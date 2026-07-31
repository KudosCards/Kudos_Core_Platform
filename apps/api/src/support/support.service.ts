import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Prisma,
  type SupportMessageAuthor,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { NotificationInboxService } from "../notifications/notification-inbox.service";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { renderBrandedEmail, escapeHtml } from "../email/email-layout";
import type { EnvConfig } from "../config/env.schema";
import type { SupportAttachment, SupportDiagnostics } from "@kudos/shared-types";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";
import type { CreateSupportTicketDto } from "./dto/create-support-ticket.dto";
import type { SupportReplyDto } from "./dto/support-reply.dto";
import type { SupportOpsReplyDto } from "./dto/support-ops-reply.dto";
import type { UpdateSupportTicketDto } from "./dto/update-support-ticket.dto";
import type { ListSupportQueryDto } from "./dto/list-support-query.dto";

/** One message in a ticket thread. Internal notes are stripped from every
 * customer-facing payload before it leaves the service. */
export interface SupportMessageView {
  id: string;
  authorType: SupportMessageAuthor;
  body: string;
  internalNote: boolean;
  createdAt: Date;
  attachments: SupportAttachment[];
}

/** A ticket row for a list (no thread) — the shared shape for both sides. */
export interface SupportTicketSummaryView {
  id: string;
  ticketNumber: number;
  subject: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  lastMessageAt: Date;
  lastMessageFrom: SupportMessageAuthor;
  createdAt: Date;
}

/** A ticket plus its full thread — the subscriber's detail view. */
export interface SupportTicketDetailView extends SupportTicketSummaryView {
  messages: SupportMessageView[];
}

/** The ops queue row — the subscriber view plus account identity + assignee. */
export interface SupportTicketOpsSummaryView extends SupportTicketSummaryView {
  accountId: string;
  businessName: string;
  /** Email of the operator handling it, or null when unassigned. */
  assignee: string | null;
}

/** The ops detail view — the full thread (including internal notes) + assignee +
 * the silently-captured browser diagnostics (ops-only). */
export interface SupportTicketOpsDetailView extends SupportTicketOpsSummaryView {
  messages: SupportMessageView[];
  diagnostics: SupportDiagnostics | null;
}

/** Statuses a ticket is still "open" in for the ops default queue — anything
 * not yet closed still needs eyes. */
const OPEN_QUEUE_STATUSES: SupportTicketStatus[] = ["open", "awaiting_customer", "resolved"];

/**
 * Two-way support ticketing. A subscriber raises a ticket from their account
 * area; the Kudos support team replies from the ops /admin portal; the thread
 * goes back and forth until it's resolved and then closed. One shared service
 * backs both the member controller (account-scoped) and the ops controller
 * (cross-account, PlatformAdmin), exactly like the Returns module. Every state
 * change carries a "whose turn" signal (status + lastMessageFrom) so both sides
 * can see who owes the next reply. See docs/adr/0066-support-ticketing.md.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inbox: NotificationInboxService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
  ) {}

  // -------------------------------------------------------------------------
  // Customer (account-scoped)
  // -------------------------------------------------------------------------

  /** Raise a ticket: creates it in `open` (support's turn) with the opening
   * message, then alerts the support inbox. */
  async createTicket(
    accountId: string,
    userId: string,
    dto: CreateSupportTicketDto,
  ): Promise<SupportTicketDetailView> {
    const now = new Date();
    const ticketId = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          accountId,
          createdByUserId: userId,
          subject: dto.subject,
          category: dto.category ?? "other",
          status: "open",
          lastMessageAt: now,
          lastMessageFrom: "customer",
          diagnostics: dto.diagnostics ? { ...dto.diagnostics } : undefined,
          messages: {
            create: {
              authorType: "customer",
              authorUserId: userId,
              body: dto.message,
              attachments: { create: this.attachmentCreates(dto.attachments) },
            },
          },
        },
      });
      await this.audit.record(
        {
          accountId,
          actorUserId: userId,
          action: "support_ticket_created",
          targetType: "SupportTicket",
          targetId: ticket.id,
          metadata: { subject: dto.subject, category: ticket.category },
        },
        tx,
      );
      return ticket.id;
    });

    const detail = await this.getForAccount(accountId, ticketId);
    await this.notifySupportInbox(detail, dto.message, "new");
    return detail;
  }

  /** The account's tickets — most recent activity first. */
  async listForAccount(accountId: string): Promise<SupportTicketSummaryView[]> {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { accountId },
      orderBy: { lastMessageAt: "desc" },
    });
    return tickets.map((t) => this.toSummary(t));
  }

  /** A single ticket with its full thread — internal notes stripped. */
  async getForAccount(accountId: string, id: string): Promise<SupportTicketDetailView> {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, accountId },
      include: {
        messages: { orderBy: { createdAt: "asc" }, include: { attachments: true } },
      },
    });
    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }
    return {
      ...this.toSummary(ticket),
      messages: ticket.messages.filter((m) => !m.internalNote).map((m) => this.toMessage(m)),
    };
  }

  /**
   * A subscriber replies on their own ticket. Any reply puts the ball back in
   * support's court (`open`) and reopens a resolved ticket; a closed ticket is
   * terminal and can't be replied to. Alerts the support inbox after commit.
   */
  async reply(
    accountId: string,
    userId: string,
    id: string,
    dto: SupportReplyDto,
  ): Promise<SupportTicketDetailView> {
    const ticket = await this.requireTicket({ id, accountId });
    if (ticket.status === "closed") {
      throw new ConflictException("This ticket is closed — raise a new ticket to continue");
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicketMessage.create({
        data: {
          ticketId: id,
          authorType: "customer",
          authorUserId: userId,
          body: dto.body,
          attachments: { create: this.attachmentCreates(dto.attachments) },
        },
      });
      await tx.supportTicket.update({
        where: { id },
        data: {
          status: "open",
          lastMessageAt: now,
          lastMessageFrom: "customer",
          // A reply reopens a resolved ticket, so clear its resolution stamp.
          resolvedAt: null,
        },
      });
      await this.audit.record(
        {
          accountId,
          actorUserId: userId,
          action: "support_ticket_customer_reply",
          targetType: "SupportTicket",
          targetId: id,
        },
        tx,
      );
    });

    const detail = await this.getForAccount(accountId, id);
    await this.notifySupportInbox(detail, dto.body, "reply");
    return detail;
  }

  /** A subscriber closes their own ticket (they're satisfied / no longer need
   * help). Terminal — no further replies. */
  async close(accountId: string, userId: string, id: string): Promise<SupportTicketDetailView> {
    const ticket = await this.requireTicket({ id, accountId });
    if (ticket.status === "closed") {
      return this.getForAccount(accountId, id);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id },
        data: { status: "closed", closedAt: new Date() },
      });
      await this.audit.record(
        {
          accountId,
          actorUserId: userId,
          action: "support_ticket_closed_by_customer",
          targetType: "SupportTicket",
          targetId: id,
        },
        tx,
      );
    });
    return this.getForAccount(accountId, id);
  }

  // -------------------------------------------------------------------------
  // Ops (cross-account, PlatformAdmin)
  // -------------------------------------------------------------------------

  /** The cross-account support queue. Defaults to everything not yet closed,
   * with the ticket that has waited longest for a reply first. */
  async listQueue(query: ListSupportQueryDto): Promise<Paginated<SupportTicketOpsSummaryView>> {
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 50);

    const where: Prisma.SupportTicketWhereInput =
      !query.status || query.status === "open"
        ? { status: { in: OPEN_QUEUE_STATUSES } }
        : { status: query.status };

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        // Oldest activity first so the longest-waiting customer is worked first.
        orderBy: { lastMessageAt: "asc" },
        include: { account: { select: { name: true } } },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    const assignees = await this.resolveAssignees(tickets.map((t) => t.assignedToUserId));
    return {
      items: tickets.map((t) => ({
        ...this.toSummary(t),
        accountId: t.accountId,
        businessName: t.account.name,
        assignee: t.assignedToUserId ? (assignees.get(t.assignedToUserId) ?? null) : null,
      })),
      total,
      page,
      perPage,
    };
  }

  /** A single ticket for ops — the full thread including internal notes. */
  async getForOps(id: string): Promise<SupportTicketOpsDetailView> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        account: { select: { name: true } },
        messages: { orderBy: { createdAt: "asc" }, include: { attachments: true } },
      },
    });
    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }
    const assignees = await this.resolveAssignees([ticket.assignedToUserId]);
    return {
      ...this.toSummary(ticket),
      accountId: ticket.accountId,
      businessName: ticket.account.name,
      assignee: ticket.assignedToUserId ? (assignees.get(ticket.assignedToUserId) ?? null) : null,
      messages: ticket.messages.map((m) => this.toMessage(m)),
      diagnostics: (ticket.diagnostics as SupportDiagnostics | null) ?? null,
    };
  }

  /**
   * An operator replies. A normal reply hands the ticket back to the customer
   * (`awaiting_customer`) and notifies them (inbox + email); an internal note is
   * support-only — it never changes whose turn it is and the customer is never
   * told. A closed ticket can't be replied to.
   */
  async opsReply(
    admin: { userId: string },
    id: string,
    dto: SupportOpsReplyDto,
  ): Promise<SupportTicketOpsDetailView> {
    const ticket = await this.requireTicket({ id });
    if (ticket.status === "closed") {
      throw new ConflictException("This ticket is closed — reopen it before replying");
    }
    const internalNote = dto.internalNote ?? false;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicketMessage.create({
        data: {
          ticketId: id,
          authorType: "support",
          authorUserId: admin.userId,
          body: dto.body,
          internalNote,
        },
      });
      // An internal note is invisible to the customer, so it leaves the "whose
      // turn" state untouched; a real reply moves the ticket to awaiting_customer.
      if (!internalNote) {
        await tx.supportTicket.update({
          where: { id },
          data: { status: "awaiting_customer", lastMessageAt: now, lastMessageFrom: "support" },
        });
      }
      await this.audit.record(
        {
          accountId: ticket.accountId,
          actorUserId: admin.userId,
          action: internalNote ? "support_ticket_internal_note" : "support_ticket_ops_reply",
          targetType: "SupportTicket",
          targetId: id,
        },
        tx,
      );
    });

    if (!internalNote) {
      await this.notifyCustomerReply(ticket.accountId, id, ticket.ticketNumber, ticket.subject, dto.body);
    }
    return this.getForOps(id);
  }

  /**
   * Ops ticket management: change status and/or priority, and (un)assign to the
   * acting operator. Resolving/closing stamps the corresponding timestamp;
   * reopening (back to open/awaiting_customer) clears the resolved/closed stamps.
   */
  async updateTicket(
    admin: { userId: string },
    id: string,
    dto: UpdateSupportTicketDto,
  ): Promise<SupportTicketOpsDetailView> {
    await this.requireTicket({ id });

    const data: Prisma.SupportTicketUpdateInput = {};
    if (dto.priority !== undefined) {
      data.priority = dto.priority;
    }
    if (dto.assign !== undefined) {
      data.assignedToUserId = dto.assign === "me" ? admin.userId : null;
    }
    if (dto.status !== undefined) {
      const { status } = dto;
      data.status = status;
      data.resolvedAt = status === "resolved" ? new Date() : null;
      data.closedAt = status === "closed" ? new Date() : null;
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.supportTicket.update({ where: { id }, data });
      await this.audit.record(
        {
          accountId: updated.accountId,
          actorUserId: admin.userId,
          action: "support_ticket_updated",
          targetType: "SupportTicket",
          targetId: id,
          metadata: {
            ...(dto.status !== undefined ? { status: dto.status } : {}),
            ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
            ...(dto.assign !== undefined ? { assign: dto.assign } : {}),
          },
        },
        tx,
      );
    });
    return this.getForOps(id);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async requireTicket(
    where: Prisma.SupportTicketWhereInput & { id: string },
  ): Promise<{
    id: string;
    accountId: string;
    ticketNumber: number;
    subject: string;
    status: SupportTicketStatus;
  }> {
    const ticket = await this.prisma.supportTicket.findFirst({
      where,
      select: { id: true, accountId: true, ticketNumber: true, subject: true, status: true },
    });
    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }
    return ticket;
  }

  private toSummary(t: {
    id: string;
    ticketNumber: number;
    subject: string;
    category: SupportTicketCategory;
    priority: SupportTicketPriority;
    status: SupportTicketStatus;
    lastMessageAt: Date;
    lastMessageFrom: SupportMessageAuthor;
    createdAt: Date;
  }): SupportTicketSummaryView {
    return {
      id: t.id,
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      status: t.status,
      lastMessageAt: t.lastMessageAt,
      lastMessageFrom: t.lastMessageFrom,
      createdAt: t.createdAt,
    };
  }

  private toMessage(m: {
    id: string;
    authorType: SupportMessageAuthor;
    body: string;
    internalNote: boolean;
    createdAt: Date;
    attachments?: {
      id: string;
      url: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      kind: SupportAttachment["kind"];
    }[];
  }): SupportMessageView {
    return {
      id: m.id,
      authorType: m.authorType,
      body: m.body,
      internalNote: m.internalNote,
      createdAt: m.createdAt,
      attachments: (m.attachments ?? []).map((a) => ({
        id: a.id,
        url: a.url,
        fileName: a.fileName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        kind: a.kind,
      })),
    };
  }

  /** Build the nested `attachments.create` rows from the (already-uploaded)
   * file references on a create/reply DTO. Returns `[]` when none were sent. */
  private attachmentCreates(
    attachments?: {
      url: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      kind: SupportAttachment["kind"];
    }[],
  ): Prisma.SupportTicketMessageAttachmentCreateWithoutMessageInput[] {
    return (attachments ?? []).map((a) => ({
      url: a.url,
      fileName: a.fileName,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      kind: a.kind,
    }));
  }

  /** Map operator user ids → their email for the assignee column. One query for
   * the whole page; nulls (unassigned) are skipped. */
  private async resolveAssignees(
    userIds: (string | null)[],
  ): Promise<Map<string, string | null>> {
    const ids = [...new Set(userIds.filter((v): v is string => v !== null))];
    if (ids.length === 0) {
      return new Map();
    }
    const admins = await this.prisma.platformAdmin.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, email: true },
    });
    return new Map(admins.map((a) => [a.userId, a.email]));
  }

  // -------------------------------------------------------------------------
  // Notifications (best-effort — never fail the workflow they observe)
  // -------------------------------------------------------------------------

  /** Tell the Kudos support team a ticket needs attention (new or a customer
   * reply). Email-only to the configured support inbox — ops also see it in the
   * queue, so a missing SUPPORT_INBOX_EMAIL just means no email nudge. */
  private async notifySupportInbox(
    detail: SupportTicketDetailView,
    body: string,
    kind: "new" | "reply",
  ): Promise<void> {
    const to = this.config.get("SUPPORT_INBOX_EMAIL", { infer: true });
    if (!to) {
      return;
    }
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const ref = this.reference(detail.ticketNumber);
    const opsUrl = `${webAppUrl}/admin/support/${detail.id}`;
    const heading =
      kind === "new" ? `New support ticket ${ref}` : `New reply on ${ref}`;
    try {
      await this.email.sendTransactional({
        to,
        subject: `${heading}: ${detail.subject}`,
        templateId: this.config.get("BREVO_SUPPORT_TICKET_TEMPLATE_ID", { infer: true }),
        params: {
          reference: ref,
          subject: detail.subject,
          category: detail.category,
          message: body,
          opsUrl,
        },
        html: renderBrandedEmail({
          webAppUrl,
          preheader: `${ref} — ${detail.subject}`,
          heading,
          bodyHtml: `
            <p style="margin:0 0 8px"><strong>${escapeHtml(detail.subject)}</strong>
              &nbsp;·&nbsp; ${escapeHtml(detail.category)}</p>
            <p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(body)}</p>`,
          cta: { url: opsUrl, label: "Open in support queue" },
        }),
      });
    } catch (error) {
      this.logger.error(
        `Support inbox email for ticket ${detail.id} failed: ${this.reasonOf(error)}`,
      );
    }
  }

  /** Tell the customer support has replied — an inbox item for every member plus
   * an email to the account. */
  private async notifyCustomerReply(
    accountId: string,
    ticketId: string,
    ticketNumber: number,
    subject: string,
    body: string,
  ): Promise<void> {
    const ref = this.reference(ticketNumber);
    const href = `/support/${ticketId}`;
    try {
      await this.inbox.notifyAccount(accountId, {
        kind: "support_reply",
        title: `Support replied to ${ref}`,
        body: subject,
        href,
        // Not idempotent across replies: each support reply is a distinct event,
        // so no entityId — every reply fans out its own inbox item.
      });
    } catch (error) {
      this.logger.error(
        `Support reply inbox notify for ticket ${ticketId} failed: ${this.reasonOf(error)}`,
      );
    }
    try {
      const email = await this.resolveAccountEmail(accountId);
      if (!email) {
        return;
      }
      const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
      const ticketUrl = `${webAppUrl}/support/${ticketId}`;
      await this.email.sendTransactional({
        to: email,
        subject: `Re: ${ref} — ${subject}`,
        templateId: this.config.get("BREVO_SUPPORT_REPLY_TEMPLATE_ID", { infer: true }),
        params: { reference: ref, subject, message: body, ticketUrl },
        html: renderBrandedEmail({
          webAppUrl,
          preheader: `Our support team has replied to ${ref}.`,
          heading: "Our support team has replied 💬",
          bodyHtml: `
            <p style="margin:0 0 16px">We've replied to your support ticket
              <strong>${escapeHtml(ref)}</strong> — ${escapeHtml(subject)}.</p>
            <p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(body)}</p>
            <p style="margin:0 0 16px">Open the ticket to read the full thread and reply.</p>`,
          cta: { url: ticketUrl, label: "View ticket" },
        }),
      });
    } catch (error) {
      this.logger.error(
        `Support reply email for ticket ${ticketId} failed: ${this.reasonOf(error)}`,
      );
    }
  }

  /** The customer's email: the account contact email if set, else the owner's
   * membership email, else any member's — mirrors ReturnsService. */
  private async resolveAccountEmail(accountId: string): Promise<string | null> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { contactEmail: true },
    });
    if (account?.contactEmail) {
      return account.contactEmail;
    }
    const members = await this.prisma.membership.findMany({
      where: { accountId, email: { not: null } },
      select: { email: true, role: true },
    });
    const owner = members.find((m) => m.role === "owner");
    return owner?.email ?? members[0]?.email ?? null;
  }

  /** The human ticket reference, rendered TKT-1000. */
  private reference(ticketNumber: number): string {
    return `TKT-${ticketNumber}`;
  }

  private reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
  }
}
