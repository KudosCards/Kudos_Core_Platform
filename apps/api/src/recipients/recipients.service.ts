import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  type KeyDateType,
  type PlanEntitlement,
  type Recipient,
  type RecipientKeyDate,
} from "@prisma/client";
import { parse } from "csv-parse/sync";
import { PrismaService } from "../prisma/prisma.service";
import { runSerializable } from "../common/run-serializable";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { AuditService } from "../audit/audit.service";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";
import type { CreateRecipientDto } from "./dto/create-recipient.dto";
import type { UpdateRecipientDto } from "./dto/update-recipient.dto";
import type { ListRecipientsQueryDto } from "./dto/list-recipients-query.dto";
import { parseRecipientRow, type ParsedRecipientRow } from "./csv-row.util";
import { suggestMapping, remapRow } from "./csv-mapping.util";
import type { CsvColumnMapping, CsvImportPreview } from "@kudos/shared-types";
import { buildScheduledBirthdayOccasion, startOfUtcDay } from "../occasions/birthday-occasion.util";
import { realignBirthdayOccasion, type RealignResult } from "../occasions/realign-birthday.util";
import { promoteDueOccasions } from "../occasions/promote-due-occasions.util";
import { buildScheduledKeyDateOccasion } from "../occasions/key-date-occasion.util";
import { keyDateTypeSchema, OPEN_OCCASION_STATUSES } from "@kudos/shared-types";
import type { UpsertKeyDateDto } from "./dto/upsert-key-date.dto";

export type { Paginated };

/**
 * A contact is "unmailable" (needs an address) when any of address line 1, city,
 * or postcode is missing or blank — the minimum to post a card via Royal Mail.
 * Shared by the recipients list filter and the dashboard "needs address" count
 * so both agree on exactly one definition. See docs/adr/0067-mandatory-addresses.md.
 */
export const MISSING_ADDRESS_WHERE: Prisma.RecipientWhereInput = {
  OR: [
    { addressLine1: null },
    { addressLine1: "" },
    { addressCity: null },
    { addressCity: "" },
    { addressPostcode: null },
    { addressPostcode: "" },
  ],
};

export interface ImportSummary {
  created: number;
  updated: number;
  /** Rows that couldn't be imported at all (e.g. missing a required name). */
  rejected: { row: number; reason: string }[];
  /** Rows that *were* imported, but with a malformed optional field dropped
   * (e.g. an unrecognised date of birth) — surfaced so nothing is silent. */
  warnings: { row: number; message: string }[];
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

/** The dedupe key refusing a write: same name, postcode and date of birth as a
 * recipient already on file. Shared so the paths that *report* it and the path
 * that *maps* it to a 409 agree on what it looks like. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

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
    actorUserId: string | null,
    dto: CreateRecipientDto,
  ): Promise<Recipient> {
    let recipient: Recipient;
    try {
      // Cap-check-then-insert is a classic TOCTOU race: two concurrent creates
      // can both read "under cap" before either commits. Serializable isolation
      // makes Postgres detect that conflict and abort one of the transactions
      // (P2034) instead of silently letting the account exceed its plan cap.
      recipient = await runSerializable(this.prisma, async (tx) => {
        await this.assertUnderCap(tx, accountId, 1);
        return tx.recipient.create({ data: { accountId, ...dto } });
      });
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw this.mapWriteError(error);
    }

    // Guest one-off purchases create a recipient with no acting user; there's
    // no one to attribute the audit entry to (actor_user_id is NOT NULL), so we
    // skip it — the recipient row itself is the record. See docs/adr/0025.
    if (actorUserId) {
      await this.audit.record({
        accountId,
        actorUserId,
        action: "create",
        targetType: "Recipient",
        targetId: recipient.id,
      });
    }

    // The recipient's birthday becomes their first calendar event the moment
    // they're added — no waiting for the nightly scheduler. See
    // ensureScheduledBirthdays and docs/adr/0016-recipient-events-and-lists.md.
    if (recipient.dateOfBirth) {
      await this.prisma.occasion.createMany({
        data: [
          buildScheduledBirthdayOccasion(
            { id: recipient.id, accountId, dateOfBirth: recipient.dateOfBirth },
            startOfUtcDay(new Date()),
          ),
        ],
        skipDuplicates: true,
      });
      // …and lands in Approvals in the same moment if it is already inside the
      // window, rather than waiting for the 06:00 sweep to notice it.
      await promoteDueOccasions(this.prisma, accountId);
    }
    return recipient;
  }

  /**
   * A transient recipient for a one-off guided send the buyer chose NOT to keep
   * in their address book. Created `archived` (source "one_off") so it satisfies
   * the order's recipient FK yet stays out of the contacts list AND out of the
   * plan's recipient cap (which counts only `active`). Deliberately skips the
   * cap check and the eager birthday occasion — it's a send target, not a
   * managed contact. See docs/adr/0018 (guided send) + the CRM-widget ADR.
   */
  async createOneOff(
    accountId: string,
    actorUserId: string | null,
    data: {
      firstName: string;
      lastName: string;
      addressLine1: string;
      addressLine2?: string;
      addressCity: string;
      addressPostcode: string;
    },
  ): Promise<Recipient> {
    let recipient: Recipient;
    try {
      recipient = await this.prisma.recipient.create({
        data: { accountId, ...data, status: "archived", source: "one_off" },
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
    if (actorUserId) {
      await this.audit.record({
        accountId,
        actorUserId,
        action: "create",
        targetType: "Recipient",
        targetId: recipient.id,
        metadata: { oneOff: true },
      });
    }
    return recipient;
  }

  async list(
    accountId: string,
    actorUserId: string,
    query: ListRecipientsQueryDto,
  ): Promise<Paginated<Recipient>> {
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 25);

    // Birthday-month filter (year-agnostic): Prisma's typed `where` can't extract
    // the month from a date column, so resolve the matching ids with a small
    // account-scoped raw query, then constrain the main query by id. An empty
    // result set naturally yields no rows (`id in ()`).
    let birthMonthIds: string[] | undefined;
    if (query.birthMonth) {
      const month = Number(query.birthMonth);
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "recipients"
        WHERE account_id = ${accountId}
          AND date_of_birth IS NOT NULL
          AND EXTRACT(MONTH FROM date_of_birth) = ${month}
      `;
      birthMonthIds = rows.map((r) => r.id);
    }

    const where: Prisma.RecipientWhereInput = {
      accountId,
      // Archived recipients live in their own "folder": the main list hides them
      // by default (show active + lapsed), and the web asks for them explicitly
      // with ?status=archived. An explicit status filter always wins.
      ...(query.status ? { status: query.status } : { status: { not: "archived" } }),
      ...(query.listId && { listMemberships: { some: { listId: query.listId } } }),
      ...(query.source && { source: query.source }),
      ...(query.missingAddress === "true" && MISSING_ADDRESS_WHERE),
      ...(birthMonthIds && { id: { in: birthMonthIds } }),
      ...(query.search && {
        // AND-wrap so a search combines with (rather than overwrites) a
        // missing-address filter that also uses OR.
        AND: [
          {
            OR: [
              { firstName: { contains: query.search, mode: "insensitive" } },
              { lastName: { contains: query.search, mode: "insensitive" } },
            ],
          },
        ],
      }),
    };

    // Column sort for the contacts table; defaults to most-recently-added.
    // Name sorts on lastName then firstName; a stable createdAt tiebreak keeps
    // pagination deterministic when a sort key repeats.
    const orderBy: Prisma.RecipientOrderByWithRelationInput[] = (() => {
      switch (query.sort) {
        case "name_asc":
          return [{ lastName: "asc" }, { firstName: "asc" }, { createdAt: "desc" }];
        case "name_desc":
          return [{ lastName: "desc" }, { firstName: "desc" }, { createdAt: "desc" }];
        case "dob_asc":
          return [{ dateOfBirth: "asc" }, { createdAt: "desc" }];
        case "dob_desc":
          return [{ dateOfBirth: "desc" }, { createdAt: "desc" }];
        default:
          return [{ createdAt: "desc" }];
      }
    })();

    // Two plain queries, not a $transaction: a paginated total needn't be a
    // consistent snapshot with the page, and wrapping a read in an explicit
    // transaction is exactly what misbehaves on a pgBouncer (transaction-mode)
    // connection pool — see docs/go-live-runbook.md §1c.
    const items = await this.prisma.recipient.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy,
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
    // Read the old date of birth before the write, so the audit entry can say
    // what it changed from.
    const previous = await this.prisma.recipient.findFirst({
      where: { id, accountId },
      select: { dateOfBirth: true },
    });
    const previousDateOfBirth = previous?.dateOfBirth ?? null;

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

    // If the date of birth changed, move the contact's live birthday onto the
    // corrected date rather than leaving it behind. Deleting only the
    // `scheduled` row (what this used to do) orphaned anything already in
    // Approvals or approved, so a contact accrued one stale birthday per
    // correction. See realign-birthday.util.ts.
    let realigned: RealignResult | null = null;
    if (dto.dateOfBirth !== undefined) {
      // In a transaction: the realign retires the losing rows before it moves
      // the keeper, so a failure part-way through used to commit the destruction
      // and leave the keeper on the old date — a correction that made things
      // worse and then failed identically on every retry. See ADR 0185.
      realigned = await this.prisma.$transaction((tx) =>
        realignBirthdayOccasion(
          tx,
          { accountId, recipientId: id, dateOfBirth: recipient.dateOfBirth },
          new Date(),
        ),
      );
      // A corrected date of birth can move a birthday into the approval window
      // as well as out of it, so re-run the same rule here too.
      if (recipient.dateOfBirth) {
        await promoteDueOccasions(this.prisma, accountId);
      }
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "update",
      targetType: "Recipient",
      targetId: id,
      // What actually changed. This used to be null, so an audit trail could
      // show that a date of birth had been edited four times and not what any
      // of the four values were — which is exactly the question asked of it.
      metadata: {
        fields: Object.keys(dto).sort(),
        ...(dto.dateOfBirth !== undefined && {
          dateOfBirth: {
            from: previousDateOfBirth ? previousDateOfBirth.toISOString().slice(0, 10) : null,
            to: recipient.dateOfBirth ? recipient.dateOfBirth.toISOString().slice(0, 10) : null,
          },
          birthdayOccasion: realigned
            ? {
                moved: realigned.moved,
                retired: realigned.retired,
                discarded: realigned.discarded,
                created: realigned.created,
                blocked: realigned.blocked,
              }
            : null,
        }),
      },
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

  /**
   * Inspect an uploaded CSV without importing: the columns, a few sample rows,
   * the row count, and an auto-detected field→column mapping. Drives the
   * import UI's mapping step so a customer's own header names ("Surname",
   * "DOB"…) don't have to match ours. See ADR 0078.
   */
  previewImport(csvBuffer: Buffer): CsvImportPreview {
    let records: string[][];
    try {
      // Parse as raw arrays (not keyed objects) so we get the header row even
      // for a header-only file, and preserve column order for the UI.
      records = parse(csvBuffer, { columns: false, skip_empty_lines: true, trim: true });
    } catch (error) {
      throw new BadRequestException(
        `Could not parse CSV: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    const [header, ...dataRows] = records;
    if (!header || header.length === 0) {
      throw new BadRequestException("The CSV has no header row.");
    }
    const columns = header;
    const toObject = (cells: string[]): Record<string, string> =>
      Object.fromEntries(columns.map((col, i) => [col, cells[i] ?? ""]));
    return {
      columns,
      sampleRows: dataRows.slice(0, 5).map(toObject),
      totalRows: dataRows.length,
      suggestedMapping: suggestMapping(columns),
    };
  }

  async importCsv(
    accountId: string,
    actorUserId: string,
    csvBuffer: Buffer,
    mapping?: CsvColumnMapping,
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

    const summary: ImportSummary = { created: 0, updated: 0, rejected: [], warnings: [] };
    const entitlement = await this.entitlements.getForAccount(accountId);

    const parsedRows: { rowNumber: number; parsed: ParsedRecipientRow }[] = [];
    rows.forEach((row, index) => {
      const rowNumber = index + 2; // +1 for 0-index, +1 for the header row
      try {
        // With a mapping, translate the file's own column names to our canonical
        // field keys first; without one, the CSV must already use our headers
        // (the documented, backward-compatible contract).
        const source = mapping ? remapRow(row, mapping) : row;
        const { parsed, warnings } = parseRecipientRow(source);
        parsedRows.push({ rowNumber, parsed });
        // A present-but-malformed optional field (e.g. an unrecognised DOB) no
        // longer rejects the row — it imports with that field dropped, recorded
        // here so the customer can see what wasn't used.
        for (const message of warnings) {
          summary.warnings.push({ row: rowNumber, message });
        }
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
    const pendingByKey = new Map<
      string,
      { rowNumber: number; recipient: Prisma.RecipientCreateManyInput }
    >();
    const candidateNewRows: { rowNumber: number; recipient: Prisma.RecipientCreateManyInput }[] =
      [];
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
          addressLine1: parsed.addressLine1,
          addressLine2: parsed.addressLine2,
          addressCity: parsed.addressCity,
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
    const { toCreate, capRejected } = await runSerializable(this.prisma, async (tx) => {
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

    // Newly imported recipients with a DOB get their birthday on the calendar
    // straight away, without waiting for the nightly scheduler.
    if (summary.created > 0) {
      await this.ensureScheduledBirthdays(accountId);
    }

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
        warnings: summary.warnings.length,
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
    const { createdCount, capSkippedIds } = await runSerializable(this.prisma, async (tx) => {
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
    //
    // One contact at a time, and a failure on one is reported rather than
    // thrown. toUpdateInput writes every column of the dedupe key (name,
    // postcode, date of birth), so an edit in the source CRM can make one
    // contact collide with another — and this loop used to abort on it, leaving
    // every contact behind it unsynced and the whole request a 500. The nightly
    // sweep then repeated that, identically, for ever. The create path above
    // already absorbs the same collision with `skipDuplicates`; this is the
    // matching guard on the way in. See ADR 0186.
    const updateErrors: { externalId: string; reason: string }[] = [];
    let updatedCount = 0;
    for (const contact of toUpdate) {
      try {
        await this.prisma.recipient.update({
          where: { id: idByExternalId.get(contact.externalId) },
          data: this.toUpdateInput(contact),
        });
        updatedCount += 1;
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error;
        // Not a system failure: the incoming values make this contact the same
        // person as one already on file. Left exactly as it was — a refusal,
        // not a partial write — and named so the customer can fix it at source.
        updateErrors.push({
          externalId: contact.externalId,
          reason:
            "Skipped: these details now match another contact already on file " +
            "(same name, postcode and date of birth)",
        });
      }
    }

    const errors = [
      ...capSkippedIds.map((externalId) => ({
        externalId,
        reason: `Plan recipient cap (${entitlement.recipientCap}) reached`,
      })),
      ...updateErrors,
    ];
    // Anything neither created nor updated nor cap-blocked collided with an
    // existing recipient's name+postcode+DOB dedupe key (a same-person match
    // from another source) — counted as skipped without a per-id reason.
    const dedupeSkipped = toCreate.length - capSkippedIds.length - createdCount;
    const skipped = capSkippedIds.length + Math.max(0, dedupeSkipped);

    // The reported bug: CRM-synced recipients carry a DOB but never reached the
    // calendar because only the nightly cron created birthday occasions. Now a
    // sync schedules them immediately — for both freshly-created contacts and
    // ones whose update just added a DOB. Idempotent, so a re-sync is a no-op.
    if (createdCount > 0 || updatedCount > 0) {
      await this.ensureScheduledBirthdays(accountId);
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "ingest",
      targetType: "Recipient",
      targetId: accountId,
      metadata: { source, created: createdCount, updated: updatedCount, skipped },
    });

    return { created: createdCount, updated: updatedCount, skipped, errors };
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

  /**
   * Ensure every active recipient in the account that has a DOB has a birthday
   * occasion on the calendar. Idempotent (skipDuplicates against the occasion
   * idempotency key), so it's safe to call after any batch that may have added
   * recipients — CSV import and CRM ingest both do. Bounded by the account's
   * recipient cap, so it's a single small scan, not a platform-wide sweep (that
   * job belongs to the nightly scheduler). See docs/adr/0016-recipient-events-and-lists.md.
   */
  private async ensureScheduledBirthdays(accountId: string): Promise<void> {
    const today = startOfUtcDay(new Date());
    const recipients = await this.prisma.recipient.findMany({
      where: { accountId, status: "active", dateOfBirth: { not: null } },
      select: { id: true, accountId: true, dateOfBirth: true },
    });
    if (recipients.length === 0) {
      return;
    }
    await this.prisma.occasion.createMany({
      data: recipients.map((recipient) =>
        buildScheduledBirthdayOccasion(
          { id: recipient.id, accountId, dateOfBirth: recipient.dateOfBirth as Date },
          today,
        ),
      ),
      skipDuplicates: true,
    });
    // The import case this was reported from: two thousand contacts land, a
    // slice of them have birthdays inside the next three weeks, and those
    // belong in Approvals now — not tomorrow morning.
    await promoteDueOccasions(this.prisma, accountId, today);
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

  private mapWriteError(error: unknown): Error {
    if (isUniqueConstraintViolation(error)) {
      return new ConflictException(
        "A recipient with the same name, postcode, and date of birth already exists",
      );
    }
    return error instanceof Error ? error : new Error("Unknown error");
  }

  // ---------------------------------------------------------------------------
  // Recurring key dates (renewal / anniversary) — see docs/adr/0104.
  // ---------------------------------------------------------------------------

  /** A recipient's key dates, guarded to the caller's account. */
  async listKeyDates(accountId: string, recipientId: string): Promise<RecipientKeyDate[]> {
    await this.assertRecipient(accountId, recipientId);
    return this.prisma.recipientKeyDate.findMany({
      where: { recipientId, accountId },
      orderBy: { type: "asc" },
    });
  }

  /**
   * Set (create-or-update) a recipient's renewal/anniversary key date, and
   * re-point its scheduled occasion at the new date — the same pattern the date
   * of birth uses for birthdays: only a still-`scheduled` occasion is replaced,
   * one already in the approval/dispatch pipeline is left alone.
   */
  async upsertKeyDate(
    accountId: string,
    actorUserId: string,
    recipientId: string,
    rawType: string,
    dto: UpsertKeyDateDto,
  ): Promise<RecipientKeyDate> {
    await this.assertRecipient(accountId, recipientId);
    const type = this.parseKeyDateType(rawType);
    const anchor = new Date(`${dto.date}T00:00:00.000Z`);
    const label = dto.label?.trim() || null;

    const occasion = buildScheduledKeyDateOccasion(
      { accountId, recipientId, type, date: anchor, label },
      startOfUtcDay(new Date()),
    );

    // One transaction: the delete and the create are two halves of "re-point
    // this key date". Run apart, a failure between them leaves the contact with
    // a key date and no occasion — nothing to approve, nothing to send, and
    // nothing on any screen to say something is missing.
    const keyDate = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.recipientKeyDate.upsert({
        where: { recipient_key_date_type: { recipientId, type } },
        create: { accountId, recipientId, type, date: anchor, label },
        update: { date: anchor, label },
      });

      // Clear this key date's occasions for any *other* date — the customer has
      // just told us that date is wrong. Only ones nothing has been spent on:
      // a queued or posted card is a real card and its occasion stays put.
      //
      // The occasion for the new date is deliberately left alone rather than
      // deleted and recreated: it may already be approved, and re-creating it
      // would silently throw that decision away and put it back in the queue.
      // Previously this deleted only `scheduled` occasions, which was enough
      // when promotion happened overnight and wrong the moment it became eager
      // — a re-dated key date would have left its old occasion sitting in
      // Approvals asking for a card on a date already corrected.
      await tx.occasion.deleteMany({
        where: {
          recipientId,
          type,
          status: { in: [...OPEN_OCCASION_STATUSES] },
          occasionDate: { not: occasion.occasionDate as Date },
        },
      });
      await tx.occasion.createMany({ data: [occasion], skipDuplicates: true });

      // …and it lands in Approvals now if it is already inside the window,
      // rather than waiting for the 06:00 sweep — which, for a key date set
      // inside the window, promotes it a day after its post-by date. Same rule
      // and same reason as create(), update() and ensureScheduledBirthdays().
      await promoteDueOccasions(tx, accountId);
      return saved;
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "key_date_set",
      targetType: "Recipient",
      targetId: recipientId,
      metadata: { type, date: dto.date },
    });
    return keyDate;
  }

  /** Remove a key date and its not-yet-actionable (scheduled) occasion. */
  async deleteKeyDate(
    accountId: string,
    actorUserId: string,
    recipientId: string,
    rawType: string,
  ): Promise<void> {
    await this.assertRecipient(accountId, recipientId);
    const type = this.parseKeyDateType(rawType);
    // Whatever stage the occasion has reached, short of a card actually being
    // paid for: removing the key date removes its occasion. Scoped to `scheduled`
    // this silently left a promoted occasion in Approvals for a date the
    // customer had just deleted.
    await this.prisma.$transaction([
      this.prisma.recipientKeyDate.deleteMany({ where: { recipientId, accountId, type } }),
      this.prisma.occasion.deleteMany({
        where: { recipientId, type, status: { in: [...OPEN_OCCASION_STATUSES] } },
      }),
    ]);
    await this.audit.record({
      accountId,
      actorUserId,
      action: "key_date_removed",
      targetType: "Recipient",
      targetId: recipientId,
      metadata: { type },
    });
  }

  private async assertRecipient(accountId: string, recipientId: string): Promise<void> {
    const recipient = await this.prisma.recipient.findFirst({
      where: { id: recipientId, accountId },
      select: { id: true },
    });
    if (!recipient) {
      throw new NotFoundException("Recipient not found");
    }
  }

  private parseKeyDateType(raw: string): KeyDateType {
    const parsed = keyDateTypeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException("Key date type must be 'renewal' or 'anniversary'");
    }
    return parsed.data;
  }
}
