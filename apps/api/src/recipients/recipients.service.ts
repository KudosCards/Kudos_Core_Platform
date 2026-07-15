import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type Recipient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { PrismaService } from "../prisma/prisma.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { AuditService } from "../audit/audit.service";
import type { CreateRecipientDto } from "./dto/create-recipient.dto";
import type { UpdateRecipientDto } from "./dto/update-recipient.dto";
import type { ListRecipientsQueryDto } from "./dto/list-recipients-query.dto";
import { parseRecipientRow } from "./csv-row.util";

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export interface ImportSummary {
  created: number;
  updated: number;
  rejected: { row: number; reason: string }[];
}

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

@Injectable()
export class RecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  async create(accountId: string, actorUserId: string, dto: CreateRecipientDto): Promise<Recipient> {
    await this.assertUnderCap(accountId, 1);

    let recipient: Recipient;
    try {
      recipient = await this.prisma.recipient.create({
        data: { accountId, ...dto },
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "create",
      targetType: "Recipient",
      targetId: recipient.id,
    });
    return recipient;
  }

  async list(
    accountId: string,
    actorUserId: string,
    query: ListRecipientsQueryDto,
  ): Promise<Paginated<Recipient>> {
    const where: Prisma.RecipientWhereInput = {
      accountId,
      ...(query.status && { status: query.status }),
      ...(query.search && {
        OR: [
          { firstName: { contains: query.search, mode: "insensitive" } },
          { lastName: { contains: query.search, mode: "insensitive" } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.recipient.findMany({
        where,
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.recipient.count({ where }),
    ]);

    await this.audit.record({
      accountId,
      actorUserId,
      action: "list",
      targetType: "Recipient",
      targetId: accountId,
      metadata: { status: query.status ?? null, search: query.search ?? null, page: query.page },
    });

    return { items, total, page: query.page, perPage: query.perPage };
  }

  async findOne(accountId: string, actorUserId: string, id: string): Promise<Recipient> {
    const recipient = await this.prisma.recipient.findFirst({ where: { id, accountId } });
    if (!recipient) {
      throw new NotFoundException("Recipient not found");
    }
    await this.audit.record({
      accountId,
      actorUserId,
      action: "view",
      targetType: "Recipient",
      targetId: id,
    });
    return recipient;
  }

  async update(
    accountId: string,
    actorUserId: string,
    id: string,
    dto: UpdateRecipientDto,
  ): Promise<Recipient> {
    await this.assertExists(accountId, id);
    try {
      const recipient = await this.prisma.recipient.update({
        where: { id },
        data: dto,
      });
      await this.audit.record({
        accountId,
        actorUserId,
        action: "update",
        targetType: "Recipient",
        targetId: id,
      });
      return recipient;
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async archive(accountId: string, actorUserId: string, id: string): Promise<Recipient> {
    await this.assertExists(accountId, id);
    const recipient = await this.prisma.recipient.update({
      where: { id },
      data: { status: "archived" },
    });
    await this.audit.record({
      accountId,
      actorUserId,
      action: "archive",
      targetType: "Recipient",
      targetId: id,
    });
    return recipient;
  }

  async importCsv(accountId: string, actorUserId: string, csvBuffer: Buffer): Promise<ImportSummary> {
    const rows: Record<string, string>[] = parse(csvBuffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const summary: ImportSummary = { created: 0, updated: 0, rejected: [] };
    const entitlement = await this.entitlements.getForAccount(accountId);
    let activeCount =
      entitlement.recipientCap === null
        ? 0
        : await this.prisma.recipient.count({ where: { accountId, status: "active" } });

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2; // +1 for 0-index, +1 for the header row
      try {
        const parsed = parseRecipientRow(row);

        const existing = await this.prisma.recipient.findFirst({
          where: {
            accountId,
            firstName: parsed.firstName,
            lastName: parsed.lastName,
            addressPostcode: parsed.addressPostcode,
            dateOfBirth: parsed.dateOfBirth,
          },
        });

        if (existing) {
          await this.prisma.recipient.update({
            where: { id: existing.id },
            data: { email: parsed.email ?? existing.email },
          });
          summary.updated += 1;
          continue;
        }

        if (entitlement.recipientCap !== null && activeCount >= entitlement.recipientCap) {
          summary.rejected.push({
            row: rowNumber,
            reason: `Plan recipient cap (${entitlement.recipientCap}) reached`,
          });
          continue;
        }

        await this.prisma.recipient.create({
          data: {
            accountId,
            firstName: parsed.firstName,
            lastName: parsed.lastName,
            dateOfBirth: parsed.dateOfBirth,
            addressPostcode: parsed.addressPostcode,
            email: parsed.email,
          },
        });
        activeCount += 1;
        summary.created += 1;
      } catch (error) {
        summary.rejected.push({
          row: rowNumber,
          reason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "import",
      targetType: "Recipient",
      targetId: accountId,
      metadata: { created: summary.created, updated: summary.updated, rejected: summary.rejected.length },
    });

    return summary;
  }

  private async assertExists(accountId: string, id: string): Promise<void> {
    const exists = await this.prisma.recipient.findFirst({ where: { id, accountId } });
    if (!exists) {
      throw new NotFoundException("Recipient not found");
    }
  }

  private async assertUnderCap(accountId: string, additional: number): Promise<void> {
    const entitlement = await this.entitlements.getForAccount(accountId);
    if (entitlement.recipientCap === null) {
      return;
    }
    const activeCount = await this.prisma.recipient.count({ where: { accountId, status: "active" } });
    if (activeCount + additional > entitlement.recipientCap) {
      throw new ForbiddenException(
        `This plan allows up to ${entitlement.recipientCap} recipients`,
      );
    }
  }

  private mapWriteError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_CONSTRAINT_VIOLATION
    ) {
      return new ConflictException(
        "A recipient with the same name, postcode, and date of birth already exists",
      );
    }
    return error instanceof Error ? error : new Error("Unknown error");
  }
}
