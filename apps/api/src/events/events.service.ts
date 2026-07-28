import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type OccasionStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SavedDesignsService } from "../saved-designs/saved-designs.service";
import { BatchOrdersService, type BatchOrder } from "../batch-orders/batch-orders.service";
import { computeDispatchDate, POSTAGE_LEAD_DAYS } from "../occasions/occasion-scheduling.constants";
import { UK_POSTCODE_REGEX } from "../common/uk-postcode";
import type { CreateEventDto } from "./dto/create-event.dto";
import type { UpdateEventDto } from "./dto/update-event.dto";
import type { AddEventMembersDto } from "./dto/add-event-members.dto";
import type { OrderEventDto } from "./dto/order-event.dto";

/** Statuses whose member occasion is still un-ordered — editable, removable,
 * and sendable. Anything else is queued-or-later (historical) or skipped. */
const SENDABLE_STATUSES: OccasionStatus[] = ["scheduled", "pending_approval", "approved"];
/** A member's card has physically gone into fulfilment (queued-or-later). */
const SENT_STATUSES = new Set<OccasionStatus>(["queued", "printed", "posted", "delivered"]);

/** The order line an event member was checked out on, so the detail view can
 * link straight to it — mirrors the occasion order-link (ADR 0055). */
const MEMBER_ORDER_LINK = {
  orderBy: { createdAt: "desc" },
  take: 1,
  select: { batchOrder: { select: { id: true, orderNumber: true, status: true } } },
} as const;

const MEMBER_INCLUDE = {
  recipient: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressPostcode: true,
      addressVerificationRequired: true,
    },
  },
  orderRecipients: MEMBER_ORDER_LINK,
} as const;

type MemberOccasion = Prisma.OccasionGetPayload<{ include: typeof MEMBER_INCLUDE }>;

export interface EventMember {
  occasionId: string;
  recipientId: string;
  firstName: string;
  lastName: string;
  status: OccasionStatus;
  dispatchDate: Date | null;
  addressVerificationRequired: boolean;
  order: { id: string; orderNumber: number; status: string } | null;
}

export interface EventSummary {
  id: string;
  accountId: string;
  title: string;
  type: string;
  eventDate: Date;
  notes: string | null;
  memberCount: number;
  sentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventWithMembers extends EventSummary {
  members: EventMember[];
}

function hasMailableAddress(r: {
  addressLine1: string | null;
  addressCity: string | null;
  addressPostcode: string | null;
}): boolean {
  return (
    !!r.addressLine1?.trim() &&
    !!r.addressCity?.trim() &&
    !!r.addressPostcode &&
    UK_POSTCODE_REGEX.test(r.addressPostcode)
  );
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly savedDesigns: SavedDesignsService,
    private readonly batchOrders: BatchOrdersService,
  ) {}

  /**
   * Create a shared event and its initial cohort. The Event owns the
   * title/type/date; each owned contact becomes a `scheduled` member occasion
   * (source shared_event) so the calendar, approvals, and checkout reuse the
   * occasion pipeline. A contact that already has an occasion of this type on
   * this date is skipped (skipDuplicates) rather than failing the whole create.
   */
  async create(
    accountId: string,
    actorUserId: string,
    dto: CreateEventDto,
  ): Promise<EventWithMembers> {
    const owned = await this.ownedRecipientIds(accountId, dto.recipientIds);
    if (owned.length === 0) {
      throw new BadRequestException("None of those contacts belong to your account");
    }

    const eventDate = new Date(dto.eventDate);
    const dispatchDate = computeDispatchDate(eventDate);
    const title = dto.title.trim();

    const event = await this.prisma.event.create({
      data: {
        accountId,
        title,
        type: dto.type,
        eventDate,
        notes: dto.notes?.trim() ? dto.notes.trim() : null,
      },
    });

    await this.prisma.occasion.createMany({
      data: owned.map((recipientId) => ({
        accountId,
        recipientId,
        eventId: event.id,
        type: dto.type,
        source: "shared_event" as const,
        title,
        occasionDate: eventDate,
        dispatchDate,
        status: "scheduled" as const,
      })),
      skipDuplicates: true,
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "create",
      targetType: "Event",
      targetId: event.id,
      metadata: { type: dto.type, requested: dto.recipientIds.length, attached: owned.length },
    });

    return this.findOne(accountId, actorUserId, event.id);
  }

  async list(
    accountId: string,
    actorUserId: string,
    query: { from?: string; to?: string },
  ): Promise<EventSummary[]> {
    const events = await this.prisma.event.findMany({
      where: {
        accountId,
        ...((query.from || query.to) && {
          eventDate: {
            ...(query.from && { gte: new Date(query.from) }),
            ...(query.to && { lte: new Date(query.to) }),
          },
        }),
      },
      orderBy: { eventDate: "asc" },
      include: { occasions: { select: { status: true } } },
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "list",
      targetType: "Event",
      targetId: accountId,
      metadata: { from: query.from ?? null, to: query.to ?? null },
    });

    return events.map((event) => this.toSummary(event, event.occasions));
  }

  async findOne(
    accountId: string,
    actorUserId: string,
    id: string,
  ): Promise<EventWithMembers> {
    const event = await this.prisma.event.findFirst({
      where: { id, accountId },
      include: {
        occasions: { orderBy: { createdAt: "asc" }, include: MEMBER_INCLUDE },
      },
    });
    if (!event) {
      throw new NotFoundException("Event not found");
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "view",
      targetType: "Event",
      targetId: id,
    });

    return {
      ...this.toSummary(event, event.occasions),
      members: event.occasions.map((o) => this.toMember(o)),
    };
  }

  /**
   * Edit the event's own fields. A date change re-dates every still-unsent
   * member occasion (and recomputes its dispatch date); a title/type change
   * cascades too. Members already ordered are left untouched — they're history.
   */
  async update(
    accountId: string,
    actorUserId: string,
    id: string,
    dto: UpdateEventDto,
  ): Promise<EventWithMembers> {
    const existing = await this.prisma.event.findFirst({ where: { id, accountId } });
    if (!existing) {
      throw new NotFoundException("Event not found");
    }

    const eventData: Prisma.EventUncheckedUpdateInput = {};
    const memberData: Prisma.OccasionUncheckedUpdateManyInput = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException("A title is required");
      eventData.title = title;
      memberData.title = title;
    }
    if (dto.type !== undefined) {
      eventData.type = dto.type;
      memberData.type = dto.type;
    }
    if (dto.eventDate !== undefined) {
      const eventDate = new Date(dto.eventDate);
      eventData.eventDate = eventDate;
      memberData.occasionDate = eventDate;
      memberData.dispatchDate = computeDispatchDate(eventDate);
    }
    if (dto.notes !== undefined) {
      eventData.notes = dto.notes.trim() ? dto.notes.trim() : null;
    }

    try {
      await this.prisma.event.update({ where: { id }, data: eventData });
      if (Object.keys(memberData).length > 0) {
        await this.prisma.occasion.updateMany({
          where: { eventId: id, accountId, status: { in: SENDABLE_STATUSES } },
          data: memberData,
        });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(
          "A contact on this event already has an event of this type on that date",
        );
      }
      throw error;
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "update",
      targetType: "Event",
      targetId: id,
    });

    return this.findOne(accountId, actorUserId, id);
  }

  async addMembers(
    accountId: string,
    actorUserId: string,
    id: string,
    dto: AddEventMembersDto,
  ): Promise<EventWithMembers> {
    const event = await this.prisma.event.findFirst({ where: { id, accountId } });
    if (!event) {
      throw new NotFoundException("Event not found");
    }

    const owned = await this.ownedRecipientIds(accountId, dto.recipientIds);
    if (owned.length === 0) {
      throw new BadRequestException("None of those contacts belong to your account");
    }

    const dispatchDate = computeDispatchDate(event.eventDate);
    const { count } = await this.prisma.occasion.createMany({
      data: owned.map((recipientId) => ({
        accountId,
        recipientId,
        eventId: id,
        type: event.type,
        source: "shared_event" as const,
        title: event.title,
        occasionDate: event.eventDate,
        dispatchDate,
        status: "scheduled" as const,
      })),
      skipDuplicates: true,
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "add_members",
      targetType: "Event",
      targetId: id,
      metadata: { added: count },
    });

    return this.findOne(accountId, actorUserId, id);
  }

  /** Remove a contact from the cohort. Only a still-unsent member can be
   * removed — once ordered it belongs to an order's history. */
  async removeMember(
    accountId: string,
    actorUserId: string,
    id: string,
    recipientId: string,
  ): Promise<void> {
    const member = await this.prisma.occasion.findFirst({
      where: { eventId: id, accountId, recipientId },
    });
    if (!member) {
      throw new NotFoundException("That contact isn't on this event");
    }
    if (!SENDABLE_STATUSES.includes(member.status)) {
      throw new ConflictException(
        `That contact's card is already "${member.status}" and can't be removed`,
      );
    }
    await this.prisma.occasion.delete({ where: { id: member.id } });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "remove_member",
      targetType: "Event",
      targetId: id,
      metadata: { recipientId },
    });
  }

  /** Delete an event and its members — blocked once any member has been sent,
   * so an order's history is never destroyed. */
  async remove(accountId: string, actorUserId: string, id: string): Promise<void> {
    const event = await this.prisma.event.findFirst({
      where: { id, accountId },
      include: { occasions: { select: { status: true } } },
    });
    if (!event) {
      throw new NotFoundException("Event not found");
    }
    if (event.occasions.some((o) => SENT_STATUSES.has(o.status))) {
      throw new ConflictException(
        "Some cards on this event have already been sent — it can't be deleted",
      );
    }
    // Member occasions cascade-delete with the event (schema relation).
    await this.prisma.event.delete({ where: { id } });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "delete",
      targetType: "Event",
      targetId: id,
    });
  }

  /**
   * Send the whole cohort in one go: approve every still-unsent member with the
   * chosen design + postage, address each from its contact's stored record, and
   * roll them into a single draft order — reusing BatchOrdersService.create, the
   * exact money path manual checkout uses. Returns the draft order the caller
   * then pays. Members already sent are left as-is.
   */
  async order(
    accountId: string,
    actorUserId: string,
    id: string,
    dto: OrderEventDto,
  ): Promise<BatchOrder> {
    // Verifies the design belongs to this account.
    await this.savedDesigns.findOne(accountId, dto.savedDesignId);

    const event = await this.prisma.event.findFirst({ where: { id, accountId } });
    if (!event) {
      throw new NotFoundException("Event not found");
    }

    const members = await this.prisma.occasion.findMany({
      where: { eventId: id, accountId, status: { in: SENDABLE_STATUSES } },
      include: { recipient: true },
    });
    if (members.length === 0) {
      throw new BadRequestException("Every card on this event has already been sent");
    }

    const missing = members.filter((m) => !m.recipient || !hasMailableAddress(m.recipient));
    if (missing.length > 0) {
      const names = missing
        .map((m) => (m.recipient ? `${m.recipient.firstName} ${m.recipient.lastName}` : "a contact"))
        .join(", ");
      throw new BadRequestException(
        `These contacts need a full UK postal address before you can send to them: ${names}`,
      );
    }

    const dispatchOption = dto.dispatchOption ?? "asap";
    const postageClass = dto.postageClass ?? "second_class";
    const memberIds = members.map((m) => m.id);

    // Approve every member with the shared design + postage; auto_send re-times
    // the dispatch date to the postage class (asap keeps the event-date lead).
    await this.prisma.occasion.updateMany({
      where: { id: { in: memberIds }, accountId, status: { in: SENDABLE_STATUSES } },
      data: {
        status: "approved",
        savedDesignId: dto.savedDesignId,
        dispatchOption,
        postageClass,
        ...(dispatchOption === "auto_send" && {
          dispatchDate: computeDispatchDate(event.eventDate, POSTAGE_LEAD_DAYS[postageClass]),
        }),
      },
    });

    // Reuse the checkout money path — consumes the member occasions (approved →
    // queued), addressed from each contact's own record.
    const order = await this.batchOrders.create(accountId, actorUserId, {
      lines: members.map((m) => ({
        occasionId: m.id,
        // Non-null: hasMailableAddress guaranteed these above.
        shippingAddressLine1: m.recipient!.addressLine1!,
        shippingAddressLine2: m.recipient!.addressLine2 ?? undefined,
        shippingAddressCity: m.recipient!.addressCity!,
        shippingAddressPostcode: m.recipient!.addressPostcode!,
        dispatchOption,
        postageClass,
      })),
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "order",
      targetType: "Event",
      targetId: id,
      metadata: { batchOrderId: order.id, cards: memberIds.length, savedDesignId: dto.savedDesignId },
    });

    return order;
  }

  /** Recipient ids from the input that actually belong to this account, de-duped
   * and preserving no particular order. */
  private async ownedRecipientIds(accountId: string, recipientIds: string[]): Promise<string[]> {
    const unique = [...new Set(recipientIds)];
    const owned = await this.prisma.recipient.findMany({
      where: { id: { in: unique }, accountId },
      select: { id: true },
    });
    return owned.map((r) => r.id);
  }

  private toSummary(
    event: { id: string; accountId: string; title: string; type: string; eventDate: Date; notes: string | null; createdAt: Date; updatedAt: Date },
    occasions: { status: OccasionStatus }[],
  ): EventSummary {
    return {
      id: event.id,
      accountId: event.accountId,
      title: event.title,
      type: event.type,
      eventDate: event.eventDate,
      notes: event.notes,
      memberCount: occasions.length,
      sentCount: occasions.filter((o) => SENT_STATUSES.has(o.status)).length,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }

  private toMember(o: MemberOccasion): EventMember {
    return {
      occasionId: o.id,
      recipientId: o.recipientId!,
      firstName: o.recipient?.firstName ?? "",
      lastName: o.recipient?.lastName ?? "",
      status: o.status,
      dispatchDate: o.dispatchDate,
      addressVerificationRequired: o.recipient?.addressVerificationRequired ?? false,
      order: o.orderRecipients[0]?.batchOrder ?? null,
    };
  }
}
