import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PlanEntitlement, type Recipient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { PrismaService } from "../prisma/prisma.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { AuditService } from "../audit/audit.service";
import type { Paginated } from "../common/paginated";
import type { CreateRecipientDto } from "./dto/create-recipient.dto";
import type { UpdateRecipientDto } from "./dto/update-recipient.dto";
import type { ListRecipientsQueryDto } from "./dto/list-recipients-query.dto";
import { parseRecipientRow, type ParsedRecipientRow } from "./csv-row.util";

export type { Paginated };

export interface ImportSummary {
  created: number;
  updated: number;
  rejected: { row: number; reason: string }[];
}

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const SERIALIZATION_FAILURE = "P2034";

/**
 * Same key shape as the recipient_dedupe_key unique index. Only meaningful when
 * the row has at least one of postcode/dateOfBirth — see importCsv, which never
 * looks rows up by this key when both are null (two recipients with the same
 * name and nothing else on file are not safe to treat as the same person).
 */
function dedupeKey(
  firstName: string,
  lastName: string,
  postcode: string | null,
  dateOfBirth: Date | null,
): string {
  return `${firstName}|${lastName}|${postcode ?? ""}|${dateOfBirth?.toISOString() ?? ""}`;
}

@Injectable()
export class RecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  async create(
    accountId: string,
    actorUserId: string,
    dto: CreateRecipientDto,
  ): Promise<Recipient> {
    let recipient: Recipient;
    try {
      // Cap-check-then-insert is a classic TOCTOU race: two concurrent creates
      // can both read "under cap" before either commits. Serializable isolation
      // makes Postgres detect that conflict and abort one of the transactions
      // (P2034) instead of silently letting the account exceed its plan cap.
      recipient = await this.runSerializable(async (tx) => {
        await this.assertUnderCap(tx, accountId, 1);
        return tx.recipient.create({ data: { accountId, ...dto } });
      });
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
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
    // Scope accountId into the mutating query itself (updateMany, not update-by-id)
    // rather than relying solely on a separate pre-check — a bare `update({ where:
    // { id } })` has no tenant guard of its own if a future change drops the
    // pre-check.
    let count: number;
    try {
      ({ count } = await this.prisma.recipient.updateMany({
        where: { id, accountId },
        data: dto,
      }));
    } catch (error) {
      throw this.mapWriteError(error);
    }
    if (count === 0) {
      throw new NotFoundException("Recipient not found");
    }

    const recipient = await this.prisma.recipient.findFirstOrThrow({ where: { id, accountId } });
    await this.audit.record({
      accountId,
      actorUserId,
      action: "update",
      targetType: "Recipient",
      targetId: id,
    });
    return recipient;
  }

  async archive(accountId: string, actorUserId: string, id: string): Promise<Recipient> {
    const { count } = await this.prisma.recipient.updateMany({
      where: { id, accountId },
      data: { status: "archived" },
    });
    if (count === 0) {
      throw new NotFoundException("Recipient not found");
    }

    const recipient = await this.prisma.recipient.findFirstOrThrow({ where: { id, accountId } });
    await this.audit.record({
      accountId,
      actorUserId,
      action: "archive",
      targetType: "Recipient",
      targetId: id,
    });
    return recipient;
  }

  async importCsv(
    accountId: string,
    actorUserId: string,
    csvBuffer: Buffer,
  ): Promise<ImportSummary> {
    let rows: Record<string, string>[];
    try {
      rows = parse(csvBuffer, { columns: true, skip_empty_lines: true, trim: true });
    } catch (error) {
      // csv-parse throws synchronously on structurally malformed input (e.g. a
      // row with a different column count than the header). Previously this
      // wasn't caught, so one bad row crashed the whole import with an
      // unhandled 500 instead of a clean 400 — that's a whole-file problem,
      // not something attributable to a single row.
      throw new BadRequestException(
        `Could not parse CSV: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    const summary: ImportSummary = { created: 0, updated: 0, rejected: [] };
    const entitlement = await this.entitlements.getForAccount(accountId);

    const parsedRows: { rowNumber: number; parsed: ParsedRecipientRow }[] = [];
    rows.forEach((row, index) => {
      const rowNumber = index + 2; // +1 for 0-index, +1 for the header row
      try {
        parsedRows.push({ rowNumber, parsed: parseRecipientRow(row) });
      } catch (error) {
        summary.rejected.push({
          row: rowNumber,
          reason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Batch the dedupe lookup instead of one findFirst per row. Only rows with
    // a postcode or DOB are eligible to match an existing recipient at all —
    // see dedupeKey's doc comment for why (NULL=NULL would otherwise silently
    // merge two different people with the same name and nothing else on file).
    const distinguishableRows = parsedRows.filter(
      ({ parsed }) => parsed.addressPostcode !== null || parsed.dateOfBirth !== null,
    );
    const existingRecipients = distinguishableRows.length
      ? await this.prisma.recipient.findMany({
          where: {
            accountId,
            OR: distinguishableRows.map(({ parsed }) => ({
              firstName: parsed.firstName,
              lastName: parsed.lastName,
            })),
          },
        })
      : [];
    const existingByKey = new Map(
      existingRecipients.map((r) => [
        dedupeKey(r.firstName, r.lastName, r.addressPostcode, r.dateOfBirth),
        r,
      ]),
    );

    let activeCount =
      entitlement.recipientCap === null
        ? 0
        : await this.prisma.recipient.count({ where: { accountId, status: "active" } });

    const toCreate: Prisma.RecipientCreateManyInput[] = [];
    // Rows already queued for creation in *this* import, keyed the same way, so
    // a second occurrence of the same new person within one file gets merged
    // into the first instead of violating the DB's unique dedupe constraint.
    const pendingByKey = new Map<string, Prisma.RecipientCreateManyInput>();
    const toUpdate: { id: string; email: string | null }[] = [];

    for (const { rowNumber, parsed } of parsedRows) {
      const hasDistinguishingInfo = parsed.addressPostcode !== null || parsed.dateOfBirth !== null;
      const key = dedupeKey(
        parsed.firstName,
        parsed.lastName,
        parsed.addressPostcode,
        parsed.dateOfBirth,
      );

      const existing = hasDistinguishingInfo ? existingByKey.get(key) : undefined;
      if (existing) {
        toUpdate.push({ id: existing.id, email: parsed.email ?? existing.email });
        summary.updated += 1;
        continue;
      }

      const pending = hasDistinguishingInfo ? pendingByKey.get(key) : undefined;
      if (pending) {
        pending.email = parsed.email ?? pending.email;
        summary.updated += 1;
        continue;
      }

      if (!this.isUnderCap(entitlement, activeCount, 1)) {
        summary.rejected.push({
          row: rowNumber,
          reason: `Plan recipient cap (${entitlement.recipientCap}) reached`,
        });
        continue;
      }

      const newRecipient: Prisma.RecipientCreateManyInput = {
        accountId,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        dateOfBirth: parsed.dateOfBirth,
        addressPostcode: parsed.addressPostcode,
        email: parsed.email,
      };
      toCreate.push(newRecipient);
      if (hasDistinguishingInfo) {
        pendingByKey.set(key, newRecipient);
      }
      activeCount += 1;
      summary.created += 1;
    }

    if (toCreate.length > 0) {
      await this.prisma.recipient.createMany({ data: toCreate });
    }
    await Promise.all(
      toUpdate.map(({ id, email }) =>
        this.prisma.recipient.update({ where: { id }, data: { email } }),
      ),
    );

    await this.audit.record({
      accountId,
      actorUserId,
      action: "import",
      targetType: "Recipient",
      targetId: accountId,
      metadata: {
        created: summary.created,
        updated: summary.updated,
        rejected: summary.rejected.length,
      },
    });

    return summary;
  }

  /** Single source of truth for the cap comparison, shared by create() (via
   * assertUnderCap) and importCsv() — previously each re-implemented this
   * check independently, risking the two rules silently drifting apart. */
  private isUnderCap(
    entitlement: PlanEntitlement,
    activeCount: number,
    additional: number,
  ): boolean {
    return (
      entitlement.recipientCap === null || activeCount + additional <= entitlement.recipientCap
    );
  }

  private async assertUnderCap(
    client: Prisma.TransactionClient,
    accountId: string,
    additional: number,
  ): Promise<void> {
    const entitlement = await this.entitlements.getForAccount(accountId);
    if (entitlement.recipientCap === null) {
      return;
    }
    const activeCount = await client.recipient.count({ where: { accountId, status: "active" } });
    if (!this.isUnderCap(entitlement, activeCount, additional)) {
      throw new ForbiddenException(`This plan allows up to ${entitlement.recipientCap} recipients`);
    }
  }

  /** Retries once or twice on a Serializable-isolation write conflict (P2034),
   * which Postgres raises when two concurrent transactions' reads/writes
   * would otherwise produce a result neither could have seen serially. */
  private async runSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const isSerializationFailure =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === SERIALIZATION_FAILURE;
        if (!isSerializationFailure || attempt === maxAttempts) {
          throw error;
        }
      }
    }
    /* istanbul ignore next -- unreachable: loop always returns or throws */
    throw new Error("Unreachable");
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
