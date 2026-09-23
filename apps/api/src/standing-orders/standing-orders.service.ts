import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma, StandingOrderAudienceKind } from "@prisma/client";
import {
  STANDING_ORDER_CONSENT_STATEMENT,
  STANDING_ORDER_CONSENT_VERSION,
  consentIsCurrent,
} from "./standing-order.consent";
import { standingOrderBlockers, type StandingOrderState } from "./standing-order-state";
import {
  designTakesMessage,
  type StandingOrder,
  type StandingOrderAudience,
} from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { runSerializable } from "../common/run-serializable";
import type { SaveStandingOrderDto, StandingOrderAudienceDto } from "./dto/save-standing-order.dto";

/** Everything a view of the instruction needs, in one read. */
const STANDING_ORDER_INCLUDE = {
  designs: {
    include: {
      savedDesign: { select: { id: true, name: true, archivedAt: true, document: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  messages: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.StandingOrderInclude;

type StandingOrderRow = Prisma.StandingOrderGetPayload<{ include: typeof STANDING_ORDER_INCLUDE }>;

/** The row, reduced to what decides whether it runs — the one shape the shared
 * rule is written against, so the view and the cron cannot feed it differently. */
export function standingOrderStateOf(row: {
  enabled: boolean;
  consentVersion: number | null;
  audienceKind: StandingOrderAudienceKind;
  recipientListId: string | null;
  segmentId: string | null;
  designs: { savedDesign: { archivedAt: Date | null } }[];
  messages: unknown[];
}): StandingOrderState {
  return {
    enabled: row.enabled,
    consentVersion: row.consentVersion,
    audienceKind: row.audienceKind,
    recipientListId: row.recipientListId,
    segmentId: row.segmentId,
    designs: row.designs.map((design) => ({ archived: design.savedDesign.archivedAt !== null })),
    messageCount: row.messages.length,
  };
}

/**
 * "Click and forget": the standing instruction, and the permission behind it.
 *
 * This phase builds the model and the consent only. Nothing here sends a card,
 * picks one, or approves an occasion — the rule that chooses a design and a
 * message is C5, and automatic approval is C6. Keeping them apart is deliberate:
 * a permission that can be reviewed before anything acts on it is a much easier
 * thing to get right than one that arrives with the machine already running.
 *
 * See docs/adr/0256 and docs/click-and-forget-plan.md.
 */
@Injectable()
export class StandingOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** The account's instruction, or the empty one they would start from. Reading
   * never creates a row — an account that has never looked at this should not
   * acquire one by looking. */
  async get(accountId: string): Promise<StandingOrder> {
    const [row, planAllows] = await Promise.all([
      this.prisma.standingOrder.findUnique({
        where: { accountId },
        include: STANDING_ORDER_INCLUDE,
      }),
      this.planAllows(accountId),
    ]);
    return this.view(row, planAllows);
  }

  /**
   * Save the whole instruction.
   *
   * Whole rather than patched, for the reason automatic top-up is (ADR 0255):
   * switching this on without saying which cards and which words is not a
   * decision anybody made. Everything is replaced in one Serializable
   * transaction, so a half-saved pool is never something the sender could read.
   */
  async save(
    accountId: string,
    actorUserId: string,
    dto: SaveStandingOrderDto,
  ): Promise<StandingOrder> {
    const planAllows = await this.planAllows(accountId);
    // Free sees the whole feature and can lay it out; only switching it on is
    // gated, so the upgrade prompt lands on somebody who has already chosen
    // their cards rather than on an empty page.
    if (dto.enabled && !planAllows) {
      throw new ForbiddenException("Your plan does not include automatic sending");
    }

    const audience = await this.resolveAudience(accountId, dto.audience);
    const savedDesignIds = await this.checkDesigns(accountId, dto.savedDesignIds);

    if (dto.enabled) {
      // Refused rather than saved-and-ignored. An instruction switched on with
      // an empty pool has nothing to send and would sit there looking live.
      if (savedDesignIds.length === 0) {
        throw new BadRequestException("Choose at least one card design before switching this on");
      }
      if (dto.messages.length === 0) {
        throw new BadRequestException("Write at least one message before switching this on");
      }
    }

    const existing = await this.prisma.standingOrder.findUnique({
      where: { accountId },
      select: { id: true, consentedAt: true, consentVersion: true, consentedByUserId: true },
    });
    const consent = this.nextConsent(existing, dto.agreeToConsent ?? false, actorUserId);

    const saved = await runSerializable(this.prisma, async (tx) => {
      const order = await tx.standingOrder.upsert({
        where: { accountId },
        create: {
          accountId,
          enabled: dto.enabled,
          audienceKind: audience.audienceKind,
          recipientListId: audience.recipientListId,
          segmentId: audience.segmentId,
          postageClass: dto.postageClass,
          ...consent,
        },
        update: {
          enabled: dto.enabled,
          audienceKind: audience.audienceKind,
          recipientListId: audience.recipientListId,
          segmentId: audience.segmentId,
          postageClass: dto.postageClass,
          ...consent,
        },
      });

      // Replace both pools wholesale. Diffing them would buy nothing — these
      // are tens of rows, written when a person presses save — and would buy it
      // at the price of a merge nobody can check by reading.
      await tx.standingOrderDesign.deleteMany({ where: { standingOrderId: order.id } });
      if (savedDesignIds.length > 0) {
        await tx.standingOrderDesign.createMany({
          data: savedDesignIds.map((savedDesignId) => ({
            standingOrderId: order.id,
            savedDesignId,
          })),
        });
      }
      await tx.standingOrderMessage.deleteMany({ where: { standingOrderId: order.id } });
      for (const message of dto.messages) {
        // Sequential creates rather than createMany: `createdAt` is what orders
        // the pool, and createMany writes them all on the same timestamp.
        await tx.standingOrderMessage.create({
          data: { standingOrderId: order.id, text: message.text, source: message.source },
        });
      }

      return tx.standingOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: STANDING_ORDER_INCLUDE,
      });
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: dto.enabled ? "standing_order_enabled" : "standing_order_disabled",
      targetType: "StandingOrder",
      targetId: saved.id,
      metadata: {
        audience: dto.audience.kind,
        designs: savedDesignIds.length,
        messages: dto.messages.length,
        postageClass: dto.postageClass,
        consentVersion: saved.consentVersion,
      },
    });

    return this.view(saved, planAllows);
  }

  /**
   * What consent the row should carry after this save.
   *
   * Agreeing is a separate act from switching on, so a save that does not agree
   * leaves whatever was recorded alone — including an out-of-date consent,
   * which stays on the record as the fact it is rather than being quietly
   * upgraded or erased.
   */
  private nextConsent(
    existing: {
      consentedAt: Date | null;
      consentVersion: number | null;
      consentedByUserId: string | null;
    } | null,
    agreeing: boolean,
    actorUserId: string,
  ): {
    consentedAt?: Date;
    consentVersion?: number;
    consentedByUserId?: string;
  } {
    if (!agreeing) {
      return existing
        ? {}
        : // A first save that does not agree records no consent at all, rather
          // than a null-shaped one that reads like a consent that failed.
          {};
    }
    return {
      consentedAt: new Date(),
      consentVersion: STANDING_ORDER_CONSENT_VERSION,
      consentedByUserId: actorUserId,
    };
  }

  /** Map the audience union onto the two nullable columns, checking the target
   * is this account's. A list or segment id from another account is not a
   * not-found for the caller to puzzle over — it is a forbidden thing to ask. */
  private async resolveAudience(
    accountId: string,
    audience: StandingOrderAudienceDto,
  ): Promise<{
    audienceKind: StandingOrderAudienceKind;
    recipientListId: string | null;
    segmentId: string | null;
  }> {
    if (audience.kind === "list") {
      // The DTO cannot express "this id is required when kind is list" — a flat
      // class is what class-validator can check — so it is checked here, where
      // the answer can be a sentence rather than a type error.
      if (!audience.listId) {
        throw new BadRequestException("Choose a contact list, or send to everybody");
      }
      const list = await this.prisma.recipientList.findFirst({
        where: { id: audience.listId, accountId },
        select: { id: true },
      });
      if (!list) throw new BadRequestException("That contact list does not exist");
      return { audienceKind: "list", recipientListId: list.id, segmentId: null };
    }
    if (audience.kind === "segment") {
      if (!audience.segmentId) {
        throw new BadRequestException("Choose a smart list, or send to everybody");
      }
      const segment = await this.prisma.segment.findFirst({
        where: { id: audience.segmentId, accountId },
        select: { id: true },
      });
      if (!segment) throw new BadRequestException("That smart list does not exist");
      return { audienceKind: "segment", recipientListId: null, segmentId: segment.id };
    }
    return { audienceKind: "all", recipientListId: null, segmentId: null };
  }

  /**
   * The design ids, de-duplicated and confirmed to be this account's live
   * designs.
   *
   * Archived ones are refused rather than silently dropped. A subscriber who
   * archived a design and left it in the pool has made a contradiction, and the
   * useful thing is to say so — dropping it would mean the cards they think
   * they chose are not the cards we would send.
   */
  private async checkDesigns(accountId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];

    const found = await this.prisma.savedDesign.findMany({
      where: { id: { in: unique }, accountId },
      select: { id: true, archivedAt: true },
    });
    const live = new Set(found.filter((design) => !design.archivedAt).map((design) => design.id));
    const missing = unique.filter((id) => !live.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `${missing.length === 1 ? "A card design is" : `${missing.length} card designs are`} no longer available — remove them and save again`,
      );
    }
    // Back in the caller's order: the pool is shown in the order it was chosen.
    return unique;
  }

  private async planAllows(accountId: string): Promise<boolean> {
    try {
      const entitlement = await this.entitlements.getForAccount(accountId);
      return entitlement.autoSendEnabled;
    } catch {
      // No plan resolves to no automatic sending, which is the safe reading and
      // matches what auto-send itself would do.
      return false;
    }
  }

  /**
   * The customer-facing view, including **why** a switched-on instruction is not
   * running.
   *
   * `enabled` and `active` are deliberately two different things. "Off" is a
   * choice somebody made; a blocker is the product declining to act on a choice
   * it can no longer honour — a downgraded plan, a deleted list, wording nobody
   * has agreed to. Showing "on" while nothing happens would be a lie, and this
   * is the feature where being lied to costs a birthday.
   */
  private view(row: StandingOrderRow | null, planAllows: boolean): StandingOrder {
    const base = {
      consentStatement: [...STANDING_ORDER_CONSENT_STATEMENT],
      consentVersion: STANDING_ORDER_CONSENT_VERSION,
      planAllows,
    };
    if (!row) {
      return {
        ...base,
        id: null,
        enabled: false,
        audience: { kind: "all" },
        postageClass: "second_class",
        designs: [],
        messages: [],
        active: false,
        blockers: [],
        consent: null,
      };
    }

    // One rule, shared with the approval cron — two definitions of "running"
    // would drift, and the drift would show up as a card that went when the
    // dashboard said it would not, or did not go when it said it would.
    const blockers = standingOrderBlockers(standingOrderStateOf(row), planAllows);

    return {
      ...base,
      id: row.id,
      enabled: row.enabled,
      audience: this.audienceOf(row),
      postageClass: row.postageClass,
      designs: row.designs.map((design) => ({
        savedDesignId: design.savedDesignId,
        name: design.savedDesign.name,
        archived: design.savedDesign.archivedAt !== null,
        takesMessage: designTakesMessage(design.savedDesign.document),
      })),
      messages: row.messages.map((message) => ({
        id: message.id,
        text: message.text,
        source: message.source,
      })),
      active: row.enabled && blockers.length === 0,
      blockers: row.enabled ? blockers : [],
      consent:
        row.consentedAt && row.consentVersion !== null
          ? {
              consentedAt: row.consentedAt,
              version: row.consentVersion,
              current: consentIsCurrent(row.consentVersion),
            }
          : null,
    };
  }

  private audienceOf(row: StandingOrderRow): StandingOrderAudience {
    if (row.recipientListId) return { kind: "list", listId: row.recipientListId };
    if (row.segmentId) return { kind: "segment", segmentId: row.segmentId };
    return { kind: "all" };
  }
}
