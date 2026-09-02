import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type Recipient } from "@prisma/client";
import {
  createSegmentInputSchema,
  previewSegmentInputSchema,
  segmentDefinitionSchema,
  updateSegmentInputSchema,
  type CreateSegmentInput,
  type PreviewSegmentInput,
  type SegmentPreview,
  type UpdateSegmentInput,
  type OccasionType,
  type SegmentDefinition,
  type SegmentMember,
  type SegmentSummary,
  type SegmentWindow,
  type SegmentsOverview,
} from "@kudos/shared-types";

/** The natural occasion a segment matched for one member, so a "send to segment"
 * can consume it and avoid a double-send. See docs/adr/0107. */
export interface SegmentReconciliationResult {
  recipientId: string;
  occasionId: string;
  occasionType: OccasionType;
  occasionDate: Date;
}

/** A segment resolved to its full member recipients, capped for one order.
 * Mirrors shared-types' `SegmentMembers` at the API boundary (with Prisma's
 * Recipient); the web parses it back via `segmentMembersSchema`. */
export interface SegmentMembersResult {
  name: string;
  members: Recipient[];
  total: number;
  capped: boolean;
  /** Per-member matched occasions (occasion-mode only; empty otherwise). */
  reconciliations: SegmentReconciliationResult[];
}

/** Occasion statuses that can still be sent — the ones a segment send should
 * consume so the natural occasion doesn't independently fire. */
const RECONCILABLE_STATUSES = ["scheduled", "pending_approval", "approved"] as const;
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { mapWithConcurrency } from "../common/map-with-concurrency";
import { MISSING_ADDRESS_WHERE } from "../recipients/recipients.service";
import { SEGMENT_PRESETS } from "./segment-presets";

/** How many members to show in a segment's preview. */
const SAMPLE_SIZE = 8;

/**
 * How many segment resolves the overview may have in flight at once.
 *
 * Each resolve is a transaction holding a pool connection, so this is how much
 * of the pool one page load can take from everything else on the instance.
 *
 * Measured on a 40-saved-list account (45 resolves, 91 queries), warm, three
 * runs each: unbounded peaks at 90 concurrent queries in ~46ms; at 24 it peaks
 * at 48 in ~45ms; at 12, 24 in ~42ms; at 6, 12 in ~45ms; at 4, 8 in ~55ms.
 * Wall-clock is flat from 6 upward — the parallelism above that was buying
 * nothing and costing the pool everything. 6 sits at the point where the curve
 * flattens.
 */
export const RESOLVE_CONCURRENCY = 6;

/**
 * When one account's saved-list count is worth someone looking at.
 *
 * ADR 0210 bounded the *concurrency* of this page and left the *total work*
 * unbounded, deliberately: a per-account cap is a product decision, and the
 * measured distribution did not justify making it. Across every account on the
 * platform the maximum was one saved list.
 *
 * That deferral is only safe while it stays true, and nothing was watching it —
 * the first account to approach the problem would announce itself as a slow
 * page nobody could explain. This is the tripwire: at fifty saved lists the
 * overview still works, and someone is told before it stops being a deferral
 * and starts being an incident. See ADR 0233.
 */
export const SAVED_SEGMENT_WARN_THRESHOLD = 50;

/** Occasion-type display labels for the member preview line (server-side copy of
 * the web's OCCASION_TYPE_LABELS — kept tiny; only the recurring types appear). */
const OCCASION_TYPE_LABELS: Record<OccasionType, string> = {
  birthday: "Birthday",
  renewal: "Renewal",
  anniversary: "Anniversary",
  achievement: "Achievement",
  leaver: "Leaver",
  staff_recognition: "Staff recognition",
  seasonal: "Seasonal",
  bespoke_campaign: "Bespoke campaign",
};

const dayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The [from, to] date range (inclusive) an occasion-mode window resolves to. */
function windowRange(window: SegmentWindow, today: Date): { from: Date; to: Date } {
  const start = startOfUtcDay(today);
  if (window.kind === "this_month") {
    return {
      from: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)),
      to: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)),
    };
  }
  if (window.kind === "next_days") {
    const to = new Date(start);
    to.setUTCDate(to.getUTCDate() + window.days);
    return { from: start, to };
  }
  return {
    from: new Date(`${window.from}T00:00:00.000Z`),
    to: new Date(`${window.to}T00:00:00.000Z`),
  };
}

@Injectable()
export class SegmentsService {
  private readonly logger = new Logger(SegmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Suggested presets + the account's saved smart lists, each resolved live.
   *
   * Every resolve is its own database transaction, so the number of them in
   * flight at once is the number of pool connections this one page load asks
   * for. Unbounded, an account with 40 saved lists demanded 45 transactions —
   * measured at 90 concurrent queries — and a handful of such loads is enough to
   * saturate a pgBouncer transaction pool and time out requests that have
   * nothing to do with this page. Bounded, the same load peaks at 12 and
   * finishes in the same wall-clock; the parallelism was buying nothing.
   *
   * Presets and saved lists share one pass rather than two, so the ceiling is
   * the ceiling — two bounded batches running concurrently would be twice it.
   * See ADR 0210.
   */
  async overview(accountId: string): Promise<SegmentsOverview> {
    // The row read is one indexed query over small rows; it is the resolving
    // that costs, so this stays whole. The page needs every saved list anyway:
    // it filters them client-side, counts them, and diffs them against the
    // suggestions to decide which are still worth offering.
    const savedRows = await this.prisma.segment.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
    });

    if (savedRows.length >= SAVED_SEGMENT_WARN_THRESHOLD) {
      // Not an error and not a limit: the page still works. It is the signal
      // that the deferral above is running out, while there is still time to
      // decide what to do about it rather than discover it from a support call.
      this.logger.warn(
        `Account ${accountId} has ${savedRows.length} saved smart lists — the segments overview ` +
          `resolves every one on each load. Above ${SAVED_SEGMENT_WARN_THRESHOLD} this is worth ` +
          `revisiting (ADR 0210's deferred per-account cap).`,
      );
    }

    const jobs: { row: (typeof savedRows)[number] | null; definition: SegmentDefinition }[] = [
      ...SEGMENT_PRESETS.map((preset) => ({ row: null, definition: preset.definition })),
      ...savedRows.map((row) => ({
        row,
        definition: segmentDefinitionSchema.parse(row.definition),
      })),
    ];

    const resolved = await mapWithConcurrency(jobs, RESOLVE_CONCURRENCY, (job) =>
      this.resolve(accountId, job.definition),
    );

    const suggested = SEGMENT_PRESETS.map((preset, index) => {
      const { count, sample } = resolved[index]!;
      return {
        id: null,
        key: preset.key,
        name: preset.name,
        description: preset.description,
        definition: preset.definition,
        count,
        sample,
        suggested: true,
      } satisfies SegmentSummary;
    });

    const saved = savedRows.map((row, index) => {
      const job = jobs[SEGMENT_PRESETS.length + index]!;
      const { count, sample } = resolved[SEGMENT_PRESETS.length + index]!;
      return {
        id: row.id,
        key: row.id,
        name: row.name,
        description: null,
        definition: job.definition,
        count,
        sample,
        suggested: false,
      } satisfies SegmentSummary;
    });

    return { suggested, saved };
  }

  /** Resolve a segment definition to a live count + a small member sample. */
  async resolve(
    accountId: string,
    definition: SegmentDefinition,
  ): Promise<{ count: number; sample: SegmentMember[] }> {
    return definition.occasion
      ? this.resolveOccasions(accountId, definition)
      : this.resolveContacts(accountId, definition);
  }

  /**
   * Resolve a segment (by preset key or saved id) to its full member recipients,
   * capped at the account's per-order limit, for seeding the bulk-send composer.
   * Throws NotFoundException if neither a preset nor a saved segment matches.
   */
  async membersForKey(accountId: string, key: string): Promise<SegmentMembersResult> {
    return this.membersFor(accountId, await this.lookupDefinition(accountId, key));
  }

  /**
   * The same thing for a hand-picked list, so `/send?list=` seeds the composer
   * exactly as `?segment=` does — one cap, one "capped" flag, one heading.
   * Resolved as a contact-mode rule scoped to the list rather than a second
   * parallel path, so the two kinds cannot drift apart.
   */
  async membersForList(accountId: string, listId: string): Promise<SegmentMembersResult> {
    if (!listId) throw new NotFoundException("List not found");
    const list = await this.prisma.recipientList.findFirst({
      where: { id: listId, accountId },
      select: { name: true },
    });
    if (!list) throw new NotFoundException("List not found");
    return this.membersFor(accountId, {
      name: list.name,
      definition: { contact: { listId } },
    });
  }

  private async membersFor(
    accountId: string,
    { name, definition }: { name: string; definition: SegmentDefinition },
  ): Promise<SegmentMembersResult> {
    const { batchOrderMaxSize } = await this.entitlements.getForAccount(accountId);
    const { members, total, capped } = await this.members(accountId, definition, batchOrderMaxSize);
    const reconciliations = await this.reconciliationsFor(accountId, definition, members);
    return { name, members, total, capped, reconciliations };
  }

  /**
   * For an occasion-mode segment, the soonest sendable natural occasion per
   * member — so the composer can offer to mark it handled and avoid a
   * double-send. Empty for contact-mode segments. Campaign occasions
   * (`one_off_campaign`) are excluded: those are sends, not events to consume.
   * See docs/adr/0107.
   */
  private async reconciliationsFor(
    accountId: string,
    definition: SegmentDefinition,
    members: Recipient[],
  ): Promise<SegmentReconciliationResult[]> {
    if (!definition.occasion || members.length === 0) return [];

    const rows = await this.prisma.occasion.findMany({
      where: {
        accountId,
        recipientId: { in: members.map((m) => m.id) },
        source: { not: "one_off_campaign" },
        status: { in: [...RECONCILABLE_STATUSES] },
        ...this.occasionMatch(definition),
      },
      orderBy: { occasionDate: "asc" },
      select: { id: true, recipientId: true, type: true, occasionDate: true },
    });

    // Keep only the soonest match per recipient (rows are date-ascending).
    const byRecipient = new Map<string, SegmentReconciliationResult>();
    for (const row of rows) {
      if (!row.recipientId || byRecipient.has(row.recipientId)) continue;
      byRecipient.set(row.recipientId, {
        recipientId: row.recipientId,
        occasionId: row.id,
        occasionType: row.type,
        occasionDate: row.occasionDate,
      });
    }
    return [...byRecipient.values()];
  }

  /** Look up a segment's name + definition from a preset key or a saved id. */
  private async lookupDefinition(
    accountId: string,
    key: string,
  ): Promise<{ name: string; definition: SegmentDefinition }> {
    // Guard an empty key — Prisma reads `id: undefined` as "no filter" and would
    // otherwise return an arbitrary saved segment.
    if (!key) throw new NotFoundException("Segment not found");

    const preset = SEGMENT_PRESETS.find((p) => p.key === key);
    if (preset) return { name: preset.name, definition: preset.definition };

    const row = await this.prisma.segment.findFirst({ where: { id: key, accountId } });
    if (row) return { name: row.name, definition: segmentDefinitionSchema.parse(row.definition) };

    throw new NotFoundException("Segment not found");
  }

  /**
   * Resolve a definition to its distinct member recipients (full records), for
   * the composer. A recipient-centric query, so each person appears once even
   * when several of their occasions match; `total` is the uncapped member count
   * and `capped` says the `limit` trimmed the returned set. Members are returned
   * regardless of postal address — the composer handles fixing/removing gaps.
   */
  async members(
    accountId: string,
    definition: SegmentDefinition,
    limit: number,
  ): Promise<{ members: Recipient[]; total: number; capped: boolean }> {
    const where: Prisma.RecipientWhereInput = {
      accountId,
      ...this.recipientFilter(definition),
      ...(definition.occasion && { occasions: { some: this.occasionMatch(definition) } }),
    };

    const [total, members] = await this.prisma.$transaction([
      this.prisma.recipient.count({ where }),
      this.prisma.recipient.findMany({
        where,
        take: limit,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { createdAt: "desc" }],
      }),
    ]);
    return { members, total, capped: total > members.length };
  }

  /** The Occasion-side predicate (type + date window) an occasion-mode segment
   * matches — shared by the preview count and the member query so they can't
   * drift. Recipient-side facets are applied separately via `recipientFilter`. */
  /**
   * The occasion-side predicate for an occasion-mode segment.
   *
   * The status bound is not optional. Without it a smart list matched an
   * occasion in *any* state, so "Birthdays this month" counted the ones already
   * posted, the ones the customer had deliberately skipped, and the ones that
   * had been missed. A real account showed a contact under "Birthdays this
   * month" against a 9 August date he had skipped himself — and his actual
   * birthday is in October.
   *
   * The display was the smaller half of it. `members()` shares this predicate,
   * so "Send to this list" seeded and charged for those same people: sending to
   * "Birthdays this month" a second time in one month posted a second card to
   * everyone who had already had one. Reconciliation would decline to consume
   * the spent occasion (it has always carried this bound) but the card was
   * still ordered and paid for.
   *
   * A smart list of dates is a list of cards still to send, so it matches only
   * the statuses where a card can still go out.
   */
  private occasionMatch(definition: SegmentDefinition): Prisma.OccasionWhereInput {
    const { types, window } = definition.occasion!;
    const { from, to } = windowRange(window, new Date());
    return {
      type: { in: types },
      status: { in: [...RECONCILABLE_STATUSES] },
      occasionDate: { gte: from, lte: to },
    };
  }

  private async resolveOccasions(
    accountId: string,
    definition: SegmentDefinition,
  ): Promise<{ count: number; sample: SegmentMember[] }> {
    const where: Prisma.OccasionWhereInput = {
      accountId,
      ...this.occasionMatch(definition),
      // A `recipient` filter implicitly excludes campaign occasions (null recipient).
      recipient: this.recipientFilter(definition),
    };

    const [count, rows] = await this.prisma.$transaction([
      this.prisma.occasion.count({ where }),
      this.prisma.occasion.findMany({
        where,
        take: SAMPLE_SIZE,
        orderBy: { occasionDate: "asc" },
        include: { recipient: { select: { id: true, firstName: true, lastName: true } } },
      }),
    ]);

    const sample: SegmentMember[] = rows
      .filter((row) => row.recipient)
      .map((row) => ({
        recipientId: row.recipient!.id,
        name: `${row.recipient!.firstName} ${row.recipient!.lastName}`.trim(),
        detail: `${OCCASION_TYPE_LABELS[row.type] ?? row.type} · ${dayMonth.format(row.occasionDate)}`,
      }));
    return { count, sample };
  }

  private async resolveContacts(
    accountId: string,
    definition: SegmentDefinition,
  ): Promise<{ count: number; sample: SegmentMember[] }> {
    const missingAddress = definition.contact?.hasMailableAddress === false;
    const where: Prisma.RecipientWhereInput = {
      accountId,
      ...this.recipientFilter(definition),
    };

    const [count, rows] = await this.prisma.$transaction([
      this.prisma.recipient.count({ where }),
      this.prisma.recipient.findMany({
        where,
        take: SAMPLE_SIZE,
        orderBy: { createdAt: "desc" },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);

    const sample: SegmentMember[] = rows.map((row) => ({
      recipientId: row.id,
      name: `${row.firstName} ${row.lastName}`.trim(),
      detail: missingAddress ? "No postal address" : "",
    }));
    return { count, sample };
  }

  /**
   * The recipient-side predicate shared by both modes (status + facets).
   *
   * `hasMailableAddress: true` used to be accepted by the schema and then
   * ignored here, so a rule asking for "only people we can post to" quietly
   * returned everyone, missing addresses included. Both directions are honoured
   * now; leaving the field off still means "either".
   */
  private recipientFilter(definition: SegmentDefinition): Prisma.RecipientWhereInput {
    const contact = definition.contact;
    return {
      status: contact?.status ?? "active",
      ...(contact?.source && { source: contact.source }),
      ...(contact?.listId && { listMemberships: { some: { listId: contact.listId } } }),
      ...(contact?.hasMailableAddress === false && MISSING_ADDRESS_WHERE),
      ...(contact?.hasMailableAddress === true && { NOT: MISSING_ADDRESS_WHERE }),
    };
  }

  /**
   * Resolve a rule that has not been saved. The builder calls this on every
   * edit so the count beside the form is the real answer for the rule as it
   * currently stands, rather than a promise the save has to make good on.
   */
  async preview(accountId: string, body: PreviewSegmentInput): Promise<SegmentPreview> {
    const parsed = previewSegmentInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid rule");
    }
    return this.resolve(accountId, parsed.data.definition);
  }

  /** Save a new segment, then return it resolved for immediate display. */
  async create(
    accountId: string,
    actorUserId: string,
    body: CreateSegmentInput,
  ): Promise<SegmentSummary> {
    const parsed = createSegmentInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid segment");
    }
    const input = parsed.data;
    let row;
    try {
      row = await this.prisma.segment.create({
        data: { accountId, name: input.name, definition: input.definition },
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "create",
      targetType: "Segment",
      targetId: row.id,
    });

    const { count, sample } = await this.resolve(accountId, input.definition);
    return {
      id: row.id,
      key: row.id,
      name: row.name,
      description: null,
      definition: input.definition,
      count,
      sample,
      suggested: false,
    };
  }

  /**
   * Rename a saved segment, change its rule, or both.
   *
   * A smart list had no way to be edited at all: the only way to change one was
   * to delete it and save a new one, which loses the name every link and habit
   * points at. Both fields are optional and at least one is required, so a
   * rename does not have to restate the rule (and cannot accidentally rewrite
   * it with a stale copy the client was holding).
   */
  async update(
    accountId: string,
    actorUserId: string,
    id: string,
    body: UpdateSegmentInput,
  ): Promise<SegmentSummary> {
    const parsed = updateSegmentInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid segment");
    }
    const input = parsed.data;

    let count: number;
    try {
      // accountId is scoped into the write itself, so there is a tenant guard
      // even if a future change drops the separate existence check.
      ({ count } = await this.prisma.segment.updateMany({
        where: { id, accountId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.definition !== undefined && { definition: input.definition }),
        },
      }));
    } catch (error) {
      throw this.mapWriteError(error);
    }
    if (count === 0) {
      throw new NotFoundException("Segment not found");
    }

    await this.audit.record({
      accountId,
      actorUserId,
      action: "update",
      targetType: "Segment",
      targetId: id,
      metadata: {
        renamed: input.name !== undefined,
        ruleChanged: input.definition !== undefined,
      },
    });

    const row = await this.prisma.segment.findFirstOrThrow({ where: { id, accountId } });
    const definition = segmentDefinitionSchema.parse(row.definition);
    const resolved = await this.resolve(accountId, definition);
    return {
      id: row.id,
      key: row.id,
      name: row.name,
      description: null,
      definition,
      count: resolved.count,
      sample: resolved.sample,
      suggested: false,
    };
  }

  async remove(accountId: string, actorUserId: string, id: string): Promise<void> {
    const { count } = await this.prisma.segment.deleteMany({ where: { id, accountId } });
    if (count === 0) {
      throw new NotFoundException("Segment not found");
    }
    await this.audit.record({
      accountId,
      actorUserId,
      action: "delete",
      targetType: "Segment",
      targetId: id,
    });
  }

  private mapWriteError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return new BadRequestException("You already have a segment with that name");
    }
    return error instanceof Error ? error : new Error("Unknown error");
  }
}
