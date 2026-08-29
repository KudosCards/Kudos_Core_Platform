import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { CreateRecipientListDto } from "./dto/create-recipient-list.dto";
import type { UpdateRecipientListDto } from "./dto/update-recipient-list.dto";
import type { AddListMembersDto } from "./dto/set-list-members.dto";

/** One previewed member, for the "who's on this" line on a list card. */
export interface RecipientListMember {
  id: string;
  firstName: string;
  lastName: string;
}

/** A list with its member count and a bounded preview of who is on it — the
 * shape every list route returns. */
export interface RecipientListSummary {
  id: string;
  name: string;
  memberCount: number;
  sample: RecipientListMember[];
  createdAt: Date;
  updatedAt: Date;
}

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

/**
 * How many members a list carries inline.
 *
 * This used to be "all of them": the detail route loaded every membership row
 * with its recipient joined, which is fine for a Year 4 class and is a table
 * scan for an account that imported five thousand contacts into one list. The
 * whole membership is read through `GET /recipients?listId=` instead — already
 * paginated, and already carrying the search, sort, status and missing-address
 * filters the contacts table uses, so a list's people are browsed with exactly
 * the same tools as everyone else's.
 *
 * Matches the sample size a smart list previews with (segments.service.ts), so
 * the two kinds of list can render through one card.
 */
const SAMPLE_SIZE = 8;

/** The bounded member preview, newest-added last — Prisma include + shaping. */
const sampleInclude = {
  _count: { select: { members: true } },
  members: {
    take: SAMPLE_SIZE,
    orderBy: { createdAt: "asc" },
    include: { recipient: { select: { id: true, firstName: true, lastName: true } } },
  },
} as const;

@Injectable()
export class RecipientListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    accountId: string,
    actorUserId: string,
    dto: CreateRecipientListDto,
  ): Promise<RecipientListSummary> {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException("A list name is required");
    }
    let list;
    try {
      list = await this.prisma.recipientList.create({ data: { accountId, name } });
    } catch (error) {
      throw this.mapWriteError(error);
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "create",
      targetType: "RecipientList",
      targetId: list.id,
    });
    return { ...list, memberCount: 0, sample: [] };
  }

  async list(accountId: string, actorUserId: string): Promise<RecipientListSummary[]> {
    const lists = await this.prisma.recipientList.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
      include: sampleInclude,
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "list",
      targetType: "RecipientList",
      targetId: accountId,
    });

    return lists.map((list) => this.toSummary(list));
  }

  async findOne(accountId: string, actorUserId: string, id: string): Promise<RecipientListSummary> {
    const list = await this.prisma.recipientList.findFirst({
      where: { id, accountId },
      include: sampleInclude,
    });
    if (!list) {
      throw new NotFoundException("List not found");
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "view",
      targetType: "RecipientList",
      targetId: id,
    });

    return this.toSummary(list);
  }

  async rename(
    accountId: string,
    actorUserId: string,
    id: string,
    dto: UpdateRecipientListDto,
  ): Promise<RecipientListSummary> {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException("A list name is required");
    }
    let count: number;
    try {
      // Scope accountId into the write itself so there's a tenant guard even if
      // a future change drops the separate existence check.
      ({ count } = await this.prisma.recipientList.updateMany({
        where: { id, accountId },
        data: { name },
      }));
    } catch (error) {
      throw this.mapWriteError(error);
    }
    if (count === 0) {
      throw new NotFoundException("List not found");
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "update",
      targetType: "RecipientList",
      targetId: id,
    });

    const list = await this.prisma.recipientList.findFirstOrThrow({
      where: { id, accountId },
      include: sampleInclude,
    });
    return this.toSummary(list);
  }

  async remove(accountId: string, actorUserId: string, id: string): Promise<void> {
    // Memberships cascade-delete with the list (see the schema relation).
    const { count } = await this.prisma.recipientList.deleteMany({ where: { id, accountId } });
    if (count === 0) {
      throw new NotFoundException("List not found");
    }
    await this.audit.record({
      accountId,
      actorUserId,
      action: "delete",
      targetType: "RecipientList",
      targetId: id,
    });
  }

  async addMembers(
    accountId: string,
    actorUserId: string,
    id: string,
    dto: AddListMembersDto,
  ): Promise<RecipientListSummary> {
    await this.assertListExists(accountId, id);

    // Only attach recipients that actually belong to this account — a stray or
    // cross-account id is dropped rather than silently linking foreign data.
    const uniqueIds = [...new Set(dto.recipientIds)];
    const owned = await this.prisma.recipient.findMany({
      where: { id: { in: uniqueIds }, accountId },
      select: { id: true },
    });
    if (owned.length === 0) {
      throw new BadRequestException("None of those recipients belong to your account");
    }

    // `added` is what actually changed, not what was asked for: re-adding
    // someone already on the list is a no-op, and the audit trail should say
    // so rather than claiming a membership it did not create.
    const { count: added } = await this.prisma.recipientListMembership.createMany({
      data: owned.map((r) => ({ listId: id, recipientId: r.id })),
      skipDuplicates: true,
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "add_members",
      targetType: "RecipientList",
      targetId: id,
      metadata: { requested: uniqueIds.length, added },
    });

    return this.reload(accountId, id);
  }

  async removeMember(
    accountId: string,
    actorUserId: string,
    id: string,
    recipientId: string,
  ): Promise<void> {
    await this.assertListExists(accountId, id);
    const { count } = await this.prisma.recipientListMembership.deleteMany({
      where: { listId: id, recipientId },
    });
    if (count === 0) {
      throw new NotFoundException("That recipient isn't on this list");
    }
    await this.audit.record({
      accountId,
      actorUserId,
      action: "remove_member",
      targetType: "RecipientList",
      targetId: id,
      metadata: { recipientId },
    });
  }

  /**
   * Take several people off a list at once — the counterpart of addMembers,
   * and what the list detail view's bulk bar calls. Unlike the single-member
   * route this does not 404 on an id that was not on the list: the caller
   * ticked rows on a view that may have moved on, and the outcome it asked for
   * (these people are not on this list) is true either way. The audit row
   * carries what actually changed.
   */
  async removeMembers(
    accountId: string,
    actorUserId: string,
    id: string,
    dto: AddListMembersDto,
  ): Promise<RecipientListSummary> {
    await this.assertListExists(accountId, id);
    const uniqueIds = [...new Set(dto.recipientIds)];
    const { count: removed } = await this.prisma.recipientListMembership.deleteMany({
      where: { listId: id, recipientId: { in: uniqueIds } },
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "remove_members",
      targetType: "RecipientList",
      targetId: id,
      metadata: { requested: uniqueIds.length, removed },
    });

    return this.reload(accountId, id);
  }

  /** Re-read a list after a membership write, without the "view" audit row
   * findOne records — a member change is one event, not two. */
  private async reload(accountId: string, id: string): Promise<RecipientListSummary> {
    const list = await this.prisma.recipientList.findFirstOrThrow({
      where: { id, accountId },
      include: sampleInclude,
    });
    return this.toSummary(list);
  }

  /** Prisma row (with `sampleInclude`) to the wire shape. */
  private toSummary(list: {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    _count: { members: number };
    members: { recipient: RecipientListMember }[];
  }): RecipientListSummary {
    return {
      id: list.id,
      name: list.name,
      memberCount: list._count.members,
      sample: list.members.map((m) => m.recipient),
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    };
  }

  /** Confirms the list exists in this account before a membership mutation, so a
   * cross-account list id surfaces a 404 rather than touching another tenant. */
  private async assertListExists(accountId: string, id: string): Promise<void> {
    const list = await this.prisma.recipientList.findFirst({
      where: { id, accountId },
      select: { id: true },
    });
    if (!list) {
      throw new NotFoundException("List not found");
    }
  }

  private mapWriteError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_CONSTRAINT_VIOLATION
    ) {
      return new ConflictException("You already have a list with that name");
    }
    return error instanceof Error ? error : new Error("Unknown error");
  }
}
