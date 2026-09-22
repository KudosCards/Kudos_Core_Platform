import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { PLATFORM_TIME_ZONE } from "../common/scheduling";
import { POSTAGE_LEAD_DAYS, computeDispatchDate } from "../occasions/occasion-scheduling.constants";
import { recipientAgeBand } from "@kudos/shared-types";
import { standingOrderBlockers } from "./standing-order-state";
import { standingOrderStateOf } from "./standing-orders.service";
import { pickStandingOrderDesign, pickStandingOrderMessage } from "./standing-order-pick";

/** Nobody triggers this — it is a cron, like auto-send's own actor. */
const SYSTEM_ACTOR = "system:standing-order";

export interface StandingOrderApprovalResult {
  /** Standing orders switched on and considered this run. */
  considered: number;
  /** Of those, the ones something was stopping. */
  blocked: number;
  /** Occasions moved into the auto-send queue. */
  approved: number;
}

/** Everything the run needs about one instruction, in one read. */
const ORDER_INCLUDE = {
  designs: {
    include: {
      savedDesign: {
        select: {
          id: true,
          archivedAt: true,
          // What the catalog says about the design this was saved from, so the
          // pick can prefer a card that suits the recipient (ADR 0259). Null
          // for a member's own uploaded artwork, which has no catalog record.
          cardDesign: { select: { ageBand: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
  messages: { select: { id: true } },
} satisfies Prisma.StandingOrderInclude;

/**
 * The half of "click and forget" that stops asking.
 *
 * Auto-send has always described itself as the hands-off half of "approve once,
 * we handle the rest", and it is — except that the *once* was per card:
 * `runDue` only ever looks at occasions a person already approved. This is what
 * approves them, so the once becomes once ever.
 *
 * Runs at 06:30, between the 06:00 scheduler that promotes birthdays into the
 * approvals queue and the 07:00 auto-send that acts on approvals. That ordering
 * is the whole design: this service only ever moves a card from "waiting for a
 * person" to "waiting for auto-send", and every existing guard downstream still
 * applies unchanged.
 *
 * **Bounded.** It approves only birthdays, only in the audience, only for
 * instructions nothing is blocking, and only from `pending_approval` — so a
 * person who approved, skipped or cancelled the card first always wins.
 *
 * See docs/adr/0257.
 */
@Injectable()
export class StandingOrderApprovalService {
  private readonly logger = new Logger(StandingOrderApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Cron("30 6 * * *", { timeZone: PLATFORM_TIME_ZONE })
  async runDue(): Promise<StandingOrderApprovalResult> {
    const orders = await this.prisma.standingOrder.findMany({
      where: { enabled: true },
      include: ORDER_INCLUDE,
    });

    const result: StandingOrderApprovalResult = {
      considered: orders.length,
      blocked: 0,
      approved: 0,
    };

    for (const order of orders) {
      try {
        // The same rule the dashboard shows. Re-read here rather than trusted
        // from a flag, because a plan can lapse, a list can be deleted and a
        // design can be archived between one morning and the next.
        const planAllows = await this.planAllows(order.accountId);
        const blockers = standingOrderBlockers(standingOrderStateOf(order), planAllows);
        if (blockers.length > 0) {
          result.blocked += 1;
          continue;
        }
        result.approved += await this.approveFor(order);
      } catch (error) {
        // One account's failure must never stop the accounts behind it.
        const detail = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Standing order for account ${order.accountId} failed: ${detail}`);
      }
    }

    this.logger.log(
      `Standing orders: ${result.considered} considered, ${result.blocked} blocked, ` +
        `${result.approved} card(s) approved`,
    );
    return result;
  }

  /** Approve every birthday this instruction covers that is still waiting for a
   * person. Returns how many moved. */
  private async approveFor(
    order: Prisma.StandingOrderGetPayload<{ include: typeof ORDER_INCLUDE }>,
  ): Promise<number> {
    const due = await this.prisma.occasion.findMany({
      where: {
        accountId: order.accountId,
        // Birthdays only, for now — the answer to "what does it cover" was
        // deliberately the simplest one.
        type: "birthday",
        // And only the rolling per-recipient ones. `type` does not say who
        // created the row: a shared event writes birthday-type occasions for a
        // whole cohort, and a bulk send writes one-off campaign rows. Neither
        // is this instruction's to approve — somebody set those up themselves
        // and is waiting to approve them themselves. See ADR 0221/0222 for the
        // two times reading `type` alone deleted a card somebody had approved.
        source: "recurring_per_recipient",
        // Never `scheduled`: those are still outside the approvals window, and
        // promoting them early would post cards weeks before they are due. The
        // 06:00 scheduler owns that promotion and this runs after it.
        status: "pending_approval",
        recipientId: { not: null },
        recipient: {
          status: "active",
          ...(order.recipientListId
            ? { listMemberships: { some: { listId: order.recipientListId } } }
            : {}),
        },
      },
      select: {
        id: true,
        recipientId: true,
        occasionDate: true,
        dispatchDateOverridden: true,
        // Age decides which cards suit this person, and is unknowable whenever
        // birthYearKnown is false — every CleanCloud contact by design.
        recipient: { select: { dateOfBirth: true, birthYearKnown: true } },
      },
      orderBy: { occasionDate: "asc" },
    });
    if (due.length === 0) return 0;

    const pool = order.designs.map((design) => ({
      savedDesignId: design.savedDesignId,
      ageBand: design.savedDesign.cardDesign?.ageBand ?? null,
    }));
    const messageIds = order.messages.map((message) => message.id);
    let approved = 0;

    for (const occasion of due) {
      // `recipientId: { not: null }` is in the query above, so the fallback is
      // never reached — it keeps the type honest rather than asserting.
      const recipientId = occasion.recipientId ?? occasion.id;
      const band = recipientAgeBand(
        occasion.recipient?.dateOfBirth ?? null,
        occasion.recipient?.birthYearKnown ?? false,
        occasion.occasionDate,
      );
      const savedDesignId = pickStandingOrderDesign(pool, recipientId, occasion.occasionDate, band);
      const standingOrderMessageId = pickStandingOrderMessage(
        messageIds,
        recipientId,
        occasion.occasionDate,
      );

      const data: Prisma.OccasionUncheckedUpdateManyInput = {
        status: "approved",
        dispatchOption: "auto_send",
        savedDesignId,
        standingOrderMessageId,
        postageClass: order.postageClass,
      };
      // Re-timed to the chosen postage class, exactly as the interactive
      // approval does — unless a human dragged this card's date on the
      // calendar, which wins over both of us (ADR 0058).
      if (!occasion.dispatchDateOverridden) {
        data.dispatchDate = computeDispatchDate(
          occasion.occasionDate,
          POSTAGE_LEAD_DAYS[order.postageClass],
        );
      }

      // Status-guarded, and deliberately the same condition the query above
      // already applied. The two are not redundant in the way they look: the
      // query is what makes the run cheap, and this is what makes it correct
      // when a person approves, skips or cancels the card in the seconds
      // between the read and the write. Remove either and the other still
      // holds today — which is exactly why a reader should be told, rather
      // than left to discover it by deleting one.
      const { count } = await this.prisma.occasion.updateMany({
        where: { id: occasion.id, accountId: order.accountId, status: "pending_approval" },
        data,
      });
      if (count === 0) continue;

      approved += 1;
      await this.audit.record({
        accountId: order.accountId,
        actorUserId: SYSTEM_ACTOR,
        action: "standing_order_approved",
        targetType: "Occasion",
        targetId: occasion.id,
        metadata: {
          savedDesignId,
          standingOrderMessageId,
          ageBand: band,
          postageClass: order.postageClass,
          standingOrderId: order.id,
        },
      });
    }

    return approved;
  }

  private async planAllows(accountId: string): Promise<boolean> {
    try {
      const entitlement = await this.entitlements.getForAccount(accountId);
      return entitlement.autoSendEnabled;
    } catch {
      // No plan resolves to no automatic sending — the safe reading, and what
      // auto-send itself would conclude a half-hour later.
      return false;
    }
  }
}
