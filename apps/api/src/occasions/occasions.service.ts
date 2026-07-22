import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SavedDesignsService } from "../saved-designs/saved-designs.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";
import { POSTAGE_LEAD_DAYS, computeDispatchDate } from "./occasion-scheduling.constants";
import type { CreateOccasionDto } from "./dto/create-occasion.dto";
import type { CreateRecipientEventDto } from "./dto/create-recipient-event.dto";
import type { UpdateOccasionEventDto } from "./dto/update-occasion-event.dto";
import type { ListOccasionsQueryDto } from "./dto/list-occasions-query.dto";
import type { ApproveOccasionDto } from "./dto/approve-occasion.dto";

/** Just enough of the recipient to show a human-readable name in the UI. */
const RECIPIENT_SELECT = { select: { firstName: true, lastName: true } } as const;

export type Occasion = Prisma.OccasionGetPayload<{
  include: { recipient: typeof RECIPIENT_SELECT };
}>;

@Injectable()
export class OccasionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly savedDesigns: SavedDesignsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async create(accountId: string, actorUserId: string, dto: CreateOccasionDto): Promise<Occasion> {
    if (dto.recipientId) {
      const recipient = await this.prisma.recipient.findFirst({
        where: { id: dto.recipientId, accountId },
      });
      if (!recipient) {
        throw new NotFoundException("Recipient not found");
      }
    }

    const occasionDate = new Date(dto.occasionDate);
    const occasion = await this.prisma.occasion.create({
      data: {
        accountId,
        recipientId: dto.recipientId ?? null,
        type: dto.type,
        source: "one_off_campaign",
        occasionDate,
        dispatchDate: computeDispatchDate(occasionDate),
        status: "pending_approval",
      },
      include: { recipient: RECIPIENT_SELECT },
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "create",
      targetType: "Occasion",
      targetId: occasion.id,
    });
    return occasion;
  }

  /**
   * Adds a hand-curated event to a recipient (a graduation, the end of exams)
   * as a `scheduled` occasion — on the calendar immediately, but out of the
   * approvals queue until the subscriber prepares a card for it (see prepare()).
   * Unlike birthdays it's a one-off, so source is `one_off_campaign`.
   */
  async createRecipientEvent(
    accountId: string,
    actorUserId: string,
    dto: CreateRecipientEventDto,
  ): Promise<Occasion> {
    const recipient = await this.prisma.recipient.findFirst({
      where: { id: dto.recipientId, accountId },
    });
    if (!recipient) {
      throw new NotFoundException("Recipient not found");
    }

    const occasionDate = new Date(dto.occasionDate);
    const title = dto.title?.trim() ? dto.title.trim() : null;
    try {
      const occasion = await this.prisma.occasion.create({
        data: {
          accountId,
          recipientId: dto.recipientId,
          type: dto.type,
          source: "one_off_campaign",
          title,
          occasionDate,
          dispatchDate: computeDispatchDate(occasionDate),
          status: "scheduled",
        },
        include: { recipient: RECIPIENT_SELECT },
      });

      await this.audit.record({
        accountId,
        actorUserId,
        action: "create_event",
        targetType: "Occasion",
        targetId: occasion.id,
        metadata: { recipientId: dto.recipientId, type: dto.type, title },
      });
      return occasion;
    } catch (error) {
      // The idempotency key is (recipientId, type, occasionDate) — a duplicate
      // event of the same type on the same day for the same recipient collides.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "That recipient already has an event of this type on this date",
        );
      }
      throw error;
    }
  }

  /**
   * Edits a `scheduled` recipient event's label and/or date. Scheduled-only:
   * the status check is in the where clause so an occasion already in the
   * approval/dispatch pipeline can't be silently re-dated under an order.
   * Re-times the dispatch date when the event date changes.
   */
  async updateEvent(
    accountId: string,
    actorUserId: string,
    id: string,
    dto: UpdateOccasionEventDto,
  ): Promise<Occasion> {
    const data: Prisma.OccasionUncheckedUpdateManyInput = {};
    if (dto.title !== undefined) {
      data.title = dto.title.trim() ? dto.title.trim() : null;
    }
    if (dto.occasionDate !== undefined) {
      const occasionDate = new Date(dto.occasionDate);
      data.occasionDate = occasionDate;
      data.dispatchDate = computeDispatchDate(occasionDate);
    }

    let count: number;
    try {
      ({ count } = await this.prisma.occasion.updateMany({
        where: { id, accountId, status: "scheduled" },
        data,
      }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(
          "That recipient already has an event of this type on this date",
        );
      }
      throw error;
    }
    if (count === 0) {
      const existing = await this.prisma.occasion.findFirst({ where: { id, accountId } });
      if (!existing) {
        throw new NotFoundException("Occasion not found");
      }
      throw new ConflictException(
        `Occasion is "${existing.status}" — only scheduled events can be edited`,
      );
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "update_event",
      targetType: "Occasion",
      targetId: id,
    });
    return this.prisma.occasion.findFirstOrThrow({
      where: { id, accountId },
      include: { recipient: RECIPIENT_SELECT },
    });
  }

  async list(
    accountId: string,
    actorUserId: string,
    query: ListOccasionsQueryDto,
  ): Promise<Paginated<Occasion>> {
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 25);
    const where: Prisma.OccasionWhereInput = {
      accountId,
      ...(query.status && { status: query.status }),
      ...(query.type && { type: query.type }),
      ...(query.recipientId && { recipientId: query.recipientId }),
      // Hide occasions for archived recipients from the account-wide views
      // (calendar, approvals) without deleting them — restoring the recipient
      // brings their events straight back. When a specific recipient is
      // requested (their detail page), show everything so the user can still
      // see and manage an archived recipient's events.
      ...(!query.recipientId && {
        OR: [{ recipientId: null }, { recipient: { status: { not: "archived" } } }],
      }),
      // Date-range window for the calendar (a visible month/week). Bounds are
      // inclusive; either end may be omitted.
      ...((query.from || query.to) && {
        occasionDate: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lte: new Date(query.to) }),
        },
      }),
    };

    // Two plain queries, not a $transaction — a paginated total needn't be a
    // consistent snapshot with the page, and an explicit read transaction is
    // what misbehaves on a pgBouncer pool (see docs/go-live-runbook.md §1c).
    const items = await this.prisma.occasion.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { occasionDate: "asc" },
      include: { recipient: RECIPIENT_SELECT },
    });
    const total = await this.prisma.occasion.count({ where });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "list",
      targetType: "Occasion",
      targetId: accountId,
      metadata: {
        status: query.status ?? null,
        type: query.type ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
        page,
      },
    });

    return { items, total, page, perPage };
  }

  async findOne(accountId: string, actorUserId: string, id: string): Promise<Occasion> {
    const occasion = await this.prisma.occasion.findFirst({
      where: { id, accountId },
      include: { recipient: RECIPIENT_SELECT },
    });
    if (!occasion) {
      throw new NotFoundException("Occasion not found");
    }
    await this.audit.record({
      accountId,
      actorUserId,
      action: "view",
      targetType: "Occasion",
      targetId: id,
    });
    return occasion;
  }

  async approve(
    accountId: string,
    actorUserId: string,
    id: string,
    dto: ApproveOccasionDto,
  ): Promise<Occasion> {
    // Also verifies the design belongs to this account (reuses the same
    // account-scoped lookup SavedDesignsController uses).
    await this.savedDesigns.findOne(accountId, dto.savedDesignId);

    const dispatchOption = dto.dispatchOption ?? "asap";
    const postageClass = dto.postageClass ?? "second_class";

    const update: Prisma.OccasionUncheckedUpdateManyInput = {
      status: "approved",
      savedDesignId: dto.savedDesignId,
      dispatchOption,
      postageClass,
    };

    // Auto-send moves money and posts a card with no further human step, so the
    // gates are enforced up front, not discovered later by the cron: the plan
    // must permit it, and the recipient must have an address we can actually
    // post to. dispatchDate is re-timed to the chosen postage class (the
    // occasion may have been scheduled with the default 5-day lead).
    if (dispatchOption === "auto_send") {
      const occasionDate = await this.assertAutoSendAllowed(accountId, id);
      update.dispatchDate = computeDispatchDate(occasionDate, POSTAGE_LEAD_DAYS[postageClass]);
    }

    const occasion = await this.transitionFromPendingApproval(accountId, id, update);

    await this.audit.record({
      accountId,
      actorUserId,
      action: "approve",
      targetType: "Occasion",
      targetId: id,
      metadata: { savedDesignId: dto.savedDesignId, dispatchOption, postageClass },
    });
    return occasion;
  }

  /**
   * Auto-send requires the plan entitlement and a complete recipient address —
   * both checked here before the occasion is approved. Returns the occasionDate
   * so the caller can re-time the dispatch date to the postage class.
   */
  private async assertAutoSendAllowed(accountId: string, occasionId: string): Promise<Date> {
    const entitlement = await this.entitlements.getForAccount(accountId);
    if (!entitlement.autoSendEnabled) {
      throw new ForbiddenException("Auto-send isn't available on your plan — upgrade to enable it");
    }

    const occasion = await this.prisma.occasion.findFirst({
      where: { id: occasionId, accountId },
      include: { recipient: true },
    });
    if (!occasion) {
      throw new NotFoundException("Occasion not found");
    }
    if (!occasion.recipient) {
      throw new BadRequestException("Auto-send needs a recipient with a postal address");
    }
    const { addressLine1, addressCity, addressPostcode } = occasion.recipient;
    if (!addressLine1 || !addressCity || !addressPostcode) {
      throw new BadRequestException(
        "This recipient is missing a postal address — add one before enabling auto-send",
      );
    }
    return occasion.occasionDate;
  }

  async skip(accountId: string, actorUserId: string, id: string): Promise<Occasion> {
    const occasion = await this.transitionFromPendingApproval(accountId, id, { status: "skipped" });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "skip",
      targetType: "Occasion",
      targetId: id,
    });
    return occasion;
  }

  /**
   * Promote a `scheduled` calendar event into the approvals queue so a card can
   * be prepared for it. The status check is in the update's where clause so two
   * concurrent prepares can't both fire; a birthday auto-promotes via the cron,
   * but this lets a subscriber pull any event forward on demand.
   */
  async prepare(accountId: string, actorUserId: string, id: string): Promise<Occasion> {
    const { count } = await this.prisma.occasion.updateMany({
      where: { id, accountId, status: "scheduled" },
      data: { status: "pending_approval" },
    });
    if (count === 0) {
      const existing = await this.prisma.occasion.findFirst({ where: { id, accountId } });
      if (!existing) {
        throw new NotFoundException("Occasion not found");
      }
      throw new ConflictException(`Occasion is "${existing.status}", not scheduled`);
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "prepare",
      targetType: "Occasion",
      targetId: id,
    });
    return this.prisma.occasion.findFirstOrThrow({
      where: { id, accountId },
      include: { recipient: RECIPIENT_SELECT },
    });
  }

  /**
   * Remove a `scheduled` calendar event. Only scheduled events can be deleted —
   * once an occasion has entered the approval/dispatch pipeline it's part of an
   * order's history and is skipped, not deleted.
   */
  async deleteEvent(accountId: string, actorUserId: string, id: string): Promise<void> {
    const { count } = await this.prisma.occasion.deleteMany({
      where: { id, accountId, status: "scheduled" },
    });
    if (count === 0) {
      const existing = await this.prisma.occasion.findFirst({ where: { id, accountId } });
      if (!existing) {
        throw new NotFoundException("Occasion not found");
      }
      throw new ConflictException(
        `Occasion is "${existing.status}" — only scheduled events can be deleted`,
      );
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "delete_event",
      targetType: "Occasion",
      targetId: id,
    });
  }

  /**
   * Atomically transitions an occasion out of pending_approval — the status
   * check lives in the update's where clause (not a separate read-then-write)
   * so two concurrent approve/skip calls on the same occasion can't both
   * succeed.
   */
  private async transitionFromPendingApproval(
    accountId: string,
    id: string,
    data: Prisma.OccasionUncheckedUpdateManyInput,
  ): Promise<Occasion> {
    const { count } = await this.prisma.occasion.updateMany({
      where: { id, accountId, status: "pending_approval" },
      data,
    });

    if (count === 0) {
      const existing = await this.prisma.occasion.findFirst({ where: { id, accountId } });
      if (!existing) {
        throw new NotFoundException("Occasion not found");
      }
      throw new ConflictException(`Occasion is "${existing.status}", not pending approval`);
    }

    return this.prisma.occasion.findFirstOrThrow({
      where: { id, accountId },
      include: { recipient: RECIPIENT_SELECT },
    });
  }
}
