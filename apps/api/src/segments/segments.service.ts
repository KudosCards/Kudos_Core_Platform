import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Recipient } from "@prisma/client";
import {
  createSegmentInputSchema,
  segmentDefinitionSchema,
  type CreateSegmentInput,
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
import { EntitlementsService } from "../entitlements/entitlements.service";
import { MISSING_ADDRESS_WHERE } from "../recipients/recipients.service";
import { SEGMENT_PRESETS } from "./segment-presets";

/** How many members to show in a segment's preview. */
const SAMPLE_SIZE = 8;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Suggested presets + the account's saved segments, each resolved live. */
  async overview(accountId: string): Promise<SegmentsOverview> {
    const [suggested, savedRows] = await Promise.all([
      Promise.all(
        SEGMENT_PRESETS.map(async (preset) => {
          const { count, sample } = await this.resolve(accountId, preset.definition);
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
        }),
      ),
      this.prisma.segment.findMany({ where: { accountId }, orderBy: { createdAt: "desc" } }),
    ]);

    const saved = await Promise.all(
      savedRows.map(async (row) => {
        const definition = segmentDefinitionSchema.parse(row.definition);
        const { count, sample } = await this.resolve(accountId, definition);
        return {
          id: row.id,
          key: row.id,
          name: row.name,
          description: null,
          definition,
          count,
          sample,
          suggested: false,
        } satisfies SegmentSummary;
      }),
    );

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
    const { name, definition } = await this.lookupDefinition(accountId, key);
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
  private occasionMatch(definition: SegmentDefinition): Prisma.OccasionWhereInput {
    const { types, window } = definition.occasion!;
    const { from, to } = windowRange(window, new Date());
    return { type: { in: types }, occasionDate: { gte: from, lte: to } };
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

  /** The recipient-side predicate shared by both modes (status + facets). */
  private recipientFilter(definition: SegmentDefinition): Prisma.RecipientWhereInput {
    const contact = definition.contact;
    return {
      status: contact?.status ?? "active",
      ...(contact?.source && { source: contact.source }),
      ...(contact?.listId && { listMemberships: { some: { listId: contact.listId } } }),
      ...(contact?.hasMailableAddress === false && MISSING_ADDRESS_WHERE),
    };
  }

  /** Save a new segment, then return it resolved for immediate display. */
  async create(accountId: string, body: CreateSegmentInput): Promise<SegmentSummary> {
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("You already have a segment with that name");
      }
      throw error;
    }
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

  async remove(accountId: string, id: string): Promise<void> {
    const { count } = await this.prisma.segment.deleteMany({ where: { id, accountId } });
    if (count === 0) {
      throw new NotFoundException("Segment not found");
    }
  }
}
