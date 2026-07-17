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
import { POSTAGE_LEAD_DAYS, computeDispatchDate } from "./occasion-scheduling.constants";
import type { CreateOccasionDto } from "./dto/create-occasion.dto";
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

  async list(
    accountId: string,
    actorUserId: string,
    query: ListOccasionsQueryDto,
  ): Promise<Paginated<Occasion>> {
    const where: Prisma.OccasionWhereInput = {
      accountId,
      ...(query.status && { status: query.status }),
      ...(query.type && { type: query.type }),
      // Date-range window for the calendar (a visible month/week). Bounds are
      // inclusive; either end may be omitted.
      ...((query.from || query.to) && {
        occasionDate: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lte: new Date(query.to) }),
        },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.occasion.findMany({
        where,
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        orderBy: { occasionDate: "asc" },
        include: { recipient: RECIPIENT_SELECT },
      }),
      this.prisma.occasion.count({ where }),
    ]);

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
        page: query.page,
      },
    });

    return { items, total, page: query.page, perPage: query.perPage };
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
