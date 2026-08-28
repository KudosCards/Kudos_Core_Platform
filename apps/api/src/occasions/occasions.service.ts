import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type OccasionType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SavedDesignsService } from "../saved-designs/saved-designs.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import type { CalendarOccasionsResponse } from "@kudos/shared-types";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";
import {
  DEFAULT_POSTAGE_LEAD_DAYS,
  POSTAGE_LEAD_DAYS,
  computeDispatchDate,
} from "./occasion-scheduling.constants";
import type { CreateOccasionDto } from "./dto/create-occasion.dto";
import type { SetDispatchDateDto } from "./dto/set-dispatch-date.dto";
import type { CreateRecipientEventDto } from "./dto/create-recipient-event.dto";
import type { UpdateOccasionEventDto } from "./dto/update-occasion-event.dto";
import type { ListOccasionsQueryDto } from "./dto/list-occasions-query.dto";
import type { ApproveOccasionDto } from "./dto/approve-occasion.dto";

/** Enough of the recipient to show a human-readable name and pre-fill the
 * checkout shipping line from the address already on the contact record (so it
 * isn't re-keyed). See ADR 0119. */
const RECIPIENT_SELECT = {
  select: {
    firstName: true,
    lastName: true,
    addressLine1: true,
    addressLine2: true,
    addressCity: true,
    addressPostcode: true,
    addressVerificationRequired: true,
  },
} as const;

/** The occasion's latest order line (if any), so the UI can link straight to
 * the order it was sent on. Newest first + take 1: an occasion is consumed into
 * a single order, but ordering defensively covers any re-order edge. */
const ORDER_LINK_ARGS = {
  orderBy: { createdAt: "desc" },
  take: 1,
  select: {
    batchOrder: { select: { id: true, orderNumber: true, status: true } },
  },
} as const;

export type Occasion = Prisma.OccasionGetPayload<{
  include: { recipient: typeof RECIPIENT_SELECT };
}>;

/**
 * A ceiling on one calendar read, so a hand-crafted decade-wide range can't ask
 * the database for everything. Not a page size — the calendar gets its whole
 * range under this, and is told when it doesn't.
 *
 * 1,000 against a measured worst case of ~537: the widest window the calendar
 * asks for is a little over three months, and the largest self-serve plan caps
 * contacts at 2,000, which works out at roughly 5.5 birthdays a day. So the
 * headroom is about double what the biggest ordinary account can produce.
 */
const CALENDAR_MAX_OCCASIONS = 1_000;

/**
 * What a calendar pill and its detail modal read, and nothing else — no
 * address, no design or postage fields, no timestamps. See
 * calendarOccasionSchema for why this is a separate shape rather than a
 * trimmed `list()`.
 */
const CALENDAR_SELECT = {
  id: true,
  recipientId: true,
  type: true,
  source: true,
  title: true,
  occasionDate: true,
  dispatchDate: true,
  dispatchDateOverridden: true,
  status: true,
  recipient: { select: { firstName: true, lastName: true } },
  orderRecipients: ORDER_LINK_ARGS,
} satisfies Prisma.OccasionSelect;

/** The order-link shape nested onto list/detail responses (see ADR 0055). */
export type OccasionOrderLink = Prisma.BatchOrderGetPayload<{
  select: { id: true; orderNumber: true; status: true };
}>;

export type OccasionWithOrder = Occasion & { order: OccasionOrderLink | null };

/** Fold the (at most one) included order line into a flat `order` field, and
 * drop the raw orderRecipients array from the response.
 *
 * Generic over the row, so the full read and the calendar's leaner one share it
 * rather than growing a second copy that could fold the link differently. */
function attachOrderLink<T extends { orderRecipients: { batchOrder: OccasionOrderLink }[] }>({
  orderRecipients,
  ...occasion
}: T): Omit<T, "orderRecipients"> & { order: OccasionOrderLink | null } {
  return { ...occasion, order: orderRecipients[0]?.batchOrder ?? null };
}

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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
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
      // The timing baseline moved, so any manual dispatch placement is cleared.
      data.dispatchDateOverridden = false;
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
  ): Promise<Paginated<OccasionWithOrder>> {
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 25);
    const where: Prisma.OccasionWhereInput = {
      accountId,
      ...(query.status && { status: query.status }),
      ...(query.dispatchOption && { dispatchOption: query.dispatchOption }),
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
    const rows = await this.prisma.occasion.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { occasionDate: "asc" },
      include: { recipient: RECIPIENT_SELECT, orderRecipients: ORDER_LINK_ARGS },
    });
    const items = rows.map(attachOrderLink);
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

  /**
   * The calendar's read: every occasion in a date range, in the shape a calendar
   * pill needs and no larger.
   *
   * Its own method rather than a flag on `list()` because the two want opposite
   * things. `list()` carries the contact's postal address so checkout can
   * pre-fill a shipping line (ADR 0119); the calendar renders no address at all,
   * and a 42-day grid on a two-thousand-contact account is around 230 pills.
   *
   * **It is not paginated, and that is the fix.** The calendar asked `list()`
   * for one page of 100 and drew whatever came back, so that same account saw
   * its month stop partway through the 17th of September with nothing to say
   * why — `parsePerPage` caps at 100 and asking for more was silently clamped.
   * A date range is a bounded question and deserves a whole answer, so this
   * returns the range. `CALENDAR_MAX_OCCASIONS` is a backstop against a range
   * nobody sensible would ask for, and when it bites the response says so
   * instead of quietly dropping the tail.
   */
  async calendar(
    accountId: string,
    query: { from: string; to: string; type?: OccasionType },
  ): Promise<CalendarOccasionsResponse> {
    const where: Prisma.OccasionWhereInput = {
      accountId,
      ...(query.type && { type: query.type }),
      // Same archived-recipient rule as the account-wide list: hidden from the
      // calendar without being deleted, so restoring the contact brings their
      // events straight back.
      OR: [{ recipientId: null }, { recipient: { status: { not: "archived" } } }],
      occasionDate: { gte: new Date(query.from), lte: new Date(query.to) },
    };

    const rows = await this.prisma.occasion.findMany({
      where,
      orderBy: { occasionDate: "asc" },
      take: CALENDAR_MAX_OCCASIONS,
      select: CALENDAR_SELECT,
    });
    // Only counted when the cap was actually reached — on every ordinary range
    // the length of what we just fetched is the total, and a second query for a
    // number we already know is a query wasted.
    const total =
      rows.length < CALENDAR_MAX_OCCASIONS
        ? rows.length
        : await this.prisma.occasion.count({ where });

    return {
      items: rows.map(attachOrderLink),
      total,
      truncated: total > rows.length,
    };
  }

  async findOne(accountId: string, actorUserId: string, id: string): Promise<OccasionWithOrder> {
    const occasion = await this.prisma.occasion.findFirst({
      where: { id, accountId },
      include: { recipient: RECIPIENT_SELECT, orderRecipients: ORDER_LINK_ARGS },
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
    return attachOrderLink(occasion);
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
    // occasion may have been scheduled with the default 5-day lead) — unless a
    // human manually placed it on the calendar, which wins.
    if (dispatchOption === "auto_send") {
      const { occasionDate, dispatchDateOverridden } = await this.assertAutoSendAllowed(
        accountId,
        id,
      );
      if (!dispatchDateOverridden) {
        update.dispatchDate = computeDispatchDate(occasionDate, POSTAGE_LEAD_DAYS[postageClass]);
      }
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
   * (to re-time the dispatch date to the postage class) and whether the dispatch
   * date was manually overridden (in which case the caller leaves it alone).
   */
  private async assertAutoSendAllowed(
    accountId: string,
    occasionId: string,
  ): Promise<{ occasionDate: Date; dispatchDateOverridden: boolean }> {
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
    return {
      occasionDate: occasion.occasionDate,
      dispatchDateOverridden: occasion.dispatchDateOverridden,
    };
  }

  /**
   * Manually place (drag) a card's dispatch date, or reset it to the working-day
   * calculation. Only occasions not yet consumed into an order can be re-timed;
   * a pinned date can't be after the occasion it's for. Sets/clears the override
   * flag so the working-day recompute (approval, event re-dating) respects it.
   */
  async setDispatchDate(
    accountId: string,
    actorUserId: string,
    id: string,
    dto: SetDispatchDateDto,
  ): Promise<Occasion> {
    const occasion = await this.prisma.occasion.findFirst({ where: { id, accountId } });
    if (!occasion) {
      throw new NotFoundException("Occasion not found");
    }
    const reschedulable = ["scheduled", "pending_approval", "approved"];
    if (!reschedulable.includes(occasion.status)) {
      throw new ConflictException(
        `Occasion is "${occasion.status}" — its dispatch date is fixed once it's on an order`,
      );
    }

    let dispatchDate: Date;
    let overridden: boolean;
    if (dto.dispatchDate === null) {
      // Reset to the calculated date — the postage lead for an approved
      // auto-send, else the default pre-approval lead.
      const leadDays =
        occasion.dispatchOption === "auto_send"
          ? POSTAGE_LEAD_DAYS[occasion.postageClass]
          : DEFAULT_POSTAGE_LEAD_DAYS;
      dispatchDate = computeDispatchDate(occasion.occasionDate, leadDays);
      overridden = false;
    } else {
      const target = new Date(dto.dispatchDate);
      if (target > occasion.occasionDate) {
        throw new BadRequestException("The dispatch date can't be after the occasion date");
      }
      dispatchDate = target;
      overridden = true;
    }

    await this.prisma.occasion.update({
      where: { id },
      data: { dispatchDate, dispatchDateOverridden: overridden },
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "set_dispatch_date",
      targetType: "Occasion",
      targetId: id,
      metadata: { dispatchDate: dispatchDate.toISOString().slice(0, 10), overridden },
    });

    return this.prisma.occasion.findFirstOrThrow({
      where: { id, accountId },
      include: { recipient: RECIPIENT_SELECT },
    });
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
   * Cancel an approval before it's actioned, returning the occasion to the
   * approvals queue (`approved` → `pending_approval`). This is how a subscriber
   * calls off a scheduled **auto-send** after ticking it — the card hasn't been
   * ordered yet (the auto-send cron only consumes it near the dispatch date). The
   * status guard is in the where clause: once the cron has taken it (status
   * `queued`) or it's otherwise moved on, count is 0 and we report it can no
   * longer be cancelled. dispatchOption resets to `asap` so a re-approval starts
   * from a clean choice; the chosen design is kept so re-approving is quick.
   */
  async unapprove(accountId: string, actorUserId: string, id: string): Promise<Occasion> {
    const { count } = await this.prisma.occasion.updateMany({
      where: { id, accountId, status: "approved" },
      data: { status: "pending_approval", dispatchOption: "asap" },
    });
    if (count === 0) {
      const existing = await this.prisma.occasion.findFirst({ where: { id, accountId } });
      if (!existing) {
        throw new NotFoundException("Occasion not found");
      }
      throw new ConflictException(
        `This card is "${existing.status}" and can no longer be cancelled — it may have already been sent`,
      );
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "unapprove",
      targetType: "Occasion",
      targetId: id,
    });
    return this.prisma.occasion.findFirstOrThrow({
      where: { id, accountId },
      include: { recipient: RECIPIENT_SELECT },
    });
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
