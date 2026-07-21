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

/** A list with its member count — the shape the lists index renders. */
export interface RecipientListSummary {
  id: string;
  name: string;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A list with its members' display details — the shape the detail view renders. */
export interface RecipientListWithMembers extends RecipientListSummary {
  members: { id: string; firstName: string; lastName: string }[];
}

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

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
    return { ...list, memberCount: 0 };
  }

  async list(accountId: string, actorUserId: string): Promise<RecipientListSummary[]> {
    const lists = await this.prisma.recipientList.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
      include: { _count: { select: { members: true } } },
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "list",
      targetType: "RecipientList",
      targetId: accountId,
    });

    return lists.map((list) => ({
      id: list.id,
      name: list.name,
      memberCount: list._count.members,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    }));
  }

  async findOne(
    accountId: string,
    actorUserId: string,
    id: string,
  ): Promise<RecipientListWithMembers> {
    const list = await this.prisma.recipientList.findFirst({
      where: { id, accountId },
      include: {
        members: {
          orderBy: { createdAt: "asc" },
          include: {
            recipient: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
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

    return {
      id: list.id,
      name: list.name,
      memberCount: list.members.length,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
      members: list.members.map((m) => m.recipient),
    };
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
      include: { _count: { select: { members: true } } },
    });
    return {
      id: list.id,
      name: list.name,
      memberCount: list._count.members,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    };
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
  ): Promise<RecipientListWithMembers> {
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

    await this.prisma.recipientListMembership.createMany({
      data: owned.map((r) => ({ listId: id, recipientId: r.id })),
      skipDuplicates: true,
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "add_members",
      targetType: "RecipientList",
      targetId: id,
      metadata: { added: owned.length },
    });

    return this.findOne(accountId, actorUserId, id);
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
