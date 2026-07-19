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
import { parsePage, parsePerPage } from "../common/pagination";
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

/**
 * A contact after DTO parsing — the normalized shape every integration source
 * maps to before it reaches the ingest funnel. `externalId` is the stable id in
 * the source system; the remaining fields are already coerced (dates parsed,
 * blanks → null). See docs/adr/0015-crm-integrations.md.
 */
export interface NormalizedContact {
  externalId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  dateOfBirth: Date | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressPostcode: string | null;
  addressCountry: string | null;
}

export interface IngestResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { externalId: string; reason: string }[];
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
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 25);
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

    // Two plain queries, not a $transaction: a paginated total needn't be a
    // consistent snapshot with the page, and wrapping a read in an explicit
    // transaction is exactly what misbehaves on a pgBouncer (transaction-mode)
    // connection pool — see docs/go-live-runbook.md §1c.
    const items = await this.prisma.recipient.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: "desc" },
    });
    const total = await this.prisma.recipient.count({ where });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "list",
      targetType: "Recipient",
      targetId: accountId,
      metadata: { status: query.status ?? null, search: query.search ?? null, page },
    });

    return { items, total, page, perPage };
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

    // Rows already queued for creation in *this* import, keyed the same way, so
    // a second occurrence of the same new person within one file gets merged
    // into the first instead of violating the DB's unique dedupe constraint.
    // This pass only resolves update-vs-new-candidate; the cap decision is
    // deferred to the transaction below so it can't race a concurrent create()
    // or importCsv() the way a plain pre-read count() would.
    const pendingByKey = new Map<string, { rowNumber: number; recipient: Prisma.RecipientCreateManyInput }>();
    const candidateNewRows: { rowNumber: number; recipient: Prisma.RecipientCreateManyInput }[] = [];
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
        pending.recipient.email = parsed.email ?? pending.recipient.email;
        summary.updated += 1;
        continue;
      }

      const candidate = {
        rowNumber,
        recipient: {
          accountId,
          source: "csv",
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          dateOfBirth: parsed.dateOfBirth,
          addressPostcode: parsed.addressPostcode,
          email: parsed.email,
        } satisfies Prisma.RecipientCreateManyInput,
      };
      candidateNewRows.push(candidate);
      if (hasDistinguishingInfo) {
        pendingByKey.set(key, candidate);
      }
    }

    // Same TOCTOU concern as create(): reading activeCount and inserting must
    // happen atomically relative to any other concurrent create()/importCsv()
    // for this account, or two imports run at once could jointly exceed the
    // plan's recipient cap even though each individually looked fine.
    // Built inside the transaction callback below, which Prisma may retry on
    // a serialization conflict (P2034) — so it must return its result rather
    // than mutate `summary` directly, or a retry would double-push rejections.
    const { toCreate, capRejected } = await this.runSerializable(async (tx) => {
      let activeCount =
        entitlement.recipientCap === null
          ? 0
          : await tx.recipient.count({ where: { accountId, status: "active" } });

      const accepted: Prisma.RecipientCreateManyInput[] = [];
      const rejected: ImportSummary["rejected"] = [];
      for (const { rowNumber, recipient } of candidateNewRows) {
        if (!this.isUnderCap(entitlement, activeCount, 1)) {
          rejected.push({
            row: rowNumber,
            reason: `Plan recipient cap (${entitlement.recipientCap}) reached`,
          });
          continue;
        }
        accepted.push(recipient);
        activeCount += 1;
      }

      if (accepted.length > 0) {
        // skipDuplicates guards the rare window where a concurrent request
        // creates a recipient matching this batch's dedupe key between our
        // pre-transaction lookup and this insert, instead of a raw P2002
        // crashing the whole import.
        await tx.recipient.createMany({ data: accepted, skipDuplicates: true });
      }
      return { toCreate: accepted, capRejected: rejected };
    });
    summary.created = toCreate.length;
    summary.rejected.push(...capRejected);

    // One UPDATE per matched existing recipient, not batched: Prisma has no
    // "update many rows, each with a different value" primitive short of
    // raw SQL, and each row's new email differs. Acceptable because this is
    // bounded by how many existing recipients a single CSV import re-matches
    // (typically a small fraction of the file, not its full row count) —
    // revisit with a raw `UPDATE ... FROM (VALUES ...)` if that stops holding.
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

  /**
   * The integration ingest funnel: upsert a batch of external contacts as
   * recipients, keyed on (accountId, source, externalId). Every integration
   * lane (the inbound API today; CRM adapters later) maps to NormalizedContact
   * and calls this, so plan-cap enforcement, dedupe, and the audit trail live
   * in exactly one place. One-way: a re-sync updates matched rows and creates
   * new ones; it never deletes. See docs/adr/0015-crm-integrations.md.
   */
  async ingestFromSource(
    accountId: string,
    source: string,
    contacts: NormalizedContact[],
    actorUserId: string,
  ): Promise<IngestResult> {
    // Collapse duplicate externalIds within the batch (last occurrence wins) so
    // one payload can't fight the (accountId, source, externalId) unique index.
    const byExternalId = new Map<string, NormalizedContact>();
    for (const contact of contacts) {
      byExternalId.set(contact.externalId, contact);
    }
    const unique = [...byExternalId.values()];

    const existing = await this.prisma.recipient.findMany({
      where: { accountId, source, externalId: { in: unique.map((c) => c.externalId) } },
      select: { id: true, externalId: true },
    });
    const idByExternalId = new Map(existing.map((r) => [r.externalId as string, r.id]));

    const toUpdate = unique.filter((c) => idByExternalId.has(c.externalId));
    const toCreate = unique.filter((c) => !idByExternalId.has(c.externalId));

    const entitlement = await this.entitlements.getForAccount(accountId);

    // Same TOCTOU concern as create()/importCsv(): the cap read and the insert
    // must be atomic relative to any other concurrent write for this account.
    // Returns its results (never mutates outer state) so a P2034 retry can't
    // double-count. capSkipped is returned per-attempt for the same reason.
    const { createdCount, capSkippedIds } = await this.runSerializable(async (tx) => {
      let activeCount =
        entitlement.recipientCap === null
          ? 0
          : await tx.recipient.count({ where: { accountId, status: "active" } });

      const accepted: Prisma.RecipientCreateManyInput[] = [];
      const capSkippedIds: string[] = [];
      for (const contact of toCreate) {
        if (!this.isUnderCap(entitlement, activeCount, 1)) {
          capSkippedIds.push(contact.externalId);
          continue;
        }
        accepted.push(this.toCreateInput(accountId, source, contact));
        activeCount += 1;
      }

      let createdCount = 0;
      if (accepted.length > 0) {
        // skipDuplicates absorbs the case where a create collides with the
        // name+postcode+DOB dedupe key of an *existing* recipient from another
        // source, instead of a raw P2002 aborting the whole ingest.
        const result = await tx.recipient.createMany({ data: accepted, skipDuplicates: true });
        createdCount = result.count;
      }
      return { createdCount, capSkippedIds };
    });

    // Refresh matched recipients — merge, don't clear: only overwrite fields the
    // incoming contact actually provides, so a CRM that doesn't carry an address
    // can't wipe one the customer added by hand.
    for (const contact of toUpdate) {
      await this.prisma.recipient.update({
        where: { id: idByExternalId.get(contact.externalId) },
        data: this.toUpdateInput(contact),
      });
    }

    const errors = capSkippedIds.map((externalId) => ({
      externalId,
      reason: `Plan recipient cap (${entitlement.recipientCap}) reached`,
    }));
    // Anything neither created nor updated nor cap-blocked collided with an
    // existing recipient's name+postcode+DOB dedupe key (a same-person match
    // from another source) — counted as skipped without a per-id reason.
    const dedupeSkipped = toCreate.length - capSkippedIds.length - createdCount;
    const skipped = capSkippedIds.length + Math.max(0, dedupeSkipped);

    await this.audit.record({
      accountId,
      actorUserId,
      action: "ingest",
      targetType: "Recipient",
      targetId: accountId,
      metadata: { source, created: createdCount, updated: toUpdate.length, skipped },
    });

    return { created: createdCount, updated: toUpdate.length, skipped, errors };
  }

  private toCreateInput(
    accountId: string,
    source: string,
    contact: NormalizedContact,
  ): Prisma.RecipientCreateManyInput {
    return {
      accountId,
      source,
      externalId: contact.externalId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      dateOfBirth: contact.dateOfBirth,
      addressLine1: contact.addressLine1,
      addressLine2: contact.addressLine2,
      addressCity: contact.addressCity,
      addressPostcode: contact.addressPostcode,
      addressCountry: contact.addressCountry ?? undefined,
    };
  }

  /** Only the fields the contact actually carries — see the "merge, don't clear"
   * note in ingestFromSource. Name is always present (required upstream). */
  private toUpdateInput(contact: NormalizedContact): Prisma.RecipientUpdateInput {
    return {
      firstName: contact.firstName,
      lastName: contact.lastName,
      ...(contact.email !== null && { email: contact.email }),
      ...(contact.dateOfBirth !== null && { dateOfBirth: contact.dateOfBirth }),
      ...(contact.addressLine1 !== null && { addressLine1: contact.addressLine1 }),
      ...(contact.addressLine2 !== null && { addressLine2: contact.addressLine2 }),
      ...(contact.addressCity !== null && { addressCity: contact.addressCity }),
      ...(contact.addressPostcode !== null && { addressPostcode: contact.addressPostcode }),
      ...(contact.addressCountry !== null && { addressCountry: contact.addressCountry }),
    };
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
    // 5, not 3: under concurrent contention three attempts can all lose the
    // serialization race and surface a P2034 as a 500 instead of the intended
    // cap rejection. See common/run-serializable.ts.
    const maxAttempts = 5;
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
