import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { FulfillmentJobStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { Paginated } from "../common/paginated";
import type { ListFulfillmentQueryDto } from "./dto/list-fulfillment-query.dto";
import type { TransitionFulfillmentDto, TransitionableStatus } from "./dto/transition-fulfillment.dto";
import type { BulkTransitionFulfillmentDto } from "./dto/bulk-transition-fulfillment.dto";

/** Everything an operator needs to physically produce and dispatch one card. */
const FULFILLMENT_JOB_SELECT = {
  id: true,
  status: true,
  assignedToUserId: true,
  printedAt: true,
  postedAt: true,
  deliveredAt: true,
  trackingReference: true,
  createdAt: true,
  orderRecipient: {
    select: {
      id: true,
      batchOrderId: true,
      shippingAddressLine1: true,
      shippingAddressLine2: true,
      shippingAddressCity: true,
      shippingAddressPostcode: true,
      shippingAddressCountry: true,
      dispatchOption: true,
      postageClass: true,
      recipient: { select: { firstName: true, lastName: true } },
      savedDesign: { select: { id: true, name: true, document: true } },
      occasion: { select: { type: true, occasionDate: true, dispatchDate: true } },
      batchOrder: { select: { accountId: true } },
    },
  },
} satisfies Prisma.FulfillmentJobSelect;

export type FulfillmentJob = Prisma.FulfillmentJobGetPayload<{ select: typeof FULFILLMENT_JOB_SELECT }>;

/** Which current statuses permit a transition *to* each target — the inverse
 * of the forward-only state machine (pending → printed → posted → delivered,
 * with failed reachable from any active state). See docs/adr/0010. */
const FROM_STATUSES: Record<TransitionableStatus, FulfillmentJobStatus[]> = {
  printed: ["pending", "in_progress"],
  posted: ["printed"],
  delivered: ["posted"],
  failed: ["pending", "in_progress", "printed", "posted"],
};

export interface BulkTransitionSummary {
  transitioned: number;
  skipped: number;
}

@Injectable()
export class FulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListFulfillmentQueryDto): Promise<Paginated<FulfillmentJob>> {
    const where: Prisma.FulfillmentJobWhereInput = {
      status: query.status ?? FulfillmentJobStatus.pending,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.fulfillmentJob.findMany({
        where,
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        // Oldest first: the queue is worked front-to-back, and dispatchDate
        // is what actually determines send urgency.
        orderBy: [{ createdAt: "asc" }],
        select: FULFILLMENT_JOB_SELECT,
      }),
      this.prisma.fulfillmentJob.count({ where }),
    ]);

    return { items, total, page: query.page, perPage: query.perPage };
  }

  async findOne(actorUserId: string, id: string): Promise<FulfillmentJob> {
    const job = await this.prisma.fulfillmentJob.findUnique({
      where: { id },
      select: FULFILLMENT_JOB_SELECT,
    });
    if (!job) {
      throw new NotFoundException("Fulfillment job not found");
    }
    // Ops viewing a card's full detail is access to a child's name + home
    // address — exactly the recipient-PII access the audit trail exists for.
    await this.audit.record({
      accountId: job.orderRecipient.batchOrder.accountId,
      actorUserId,
      action: "fulfillment_view",
      targetType: "FulfillmentJob",
      targetId: id,
    });
    return job;
  }

  /** Optional "I'm working on this" assignment: pending → in_progress. */
  async claim(actorUserId: string, id: string): Promise<FulfillmentJob> {
    const { count } = await this.prisma.fulfillmentJob.updateMany({
      where: { id, status: "pending" },
      data: { status: "in_progress", assignedToUserId: actorUserId },
    });
    if (count === 0) {
      const existing = await this.prisma.fulfillmentJob.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException("Fulfillment job not found");
      }
      throw new ConflictException(`Job is "${existing.status}", not claimable`);
    }
    return this.prisma.fulfillmentJob.findUniqueOrThrow({
      where: { id },
      select: FULFILLMENT_JOB_SELECT,
    });
  }

  async transition(
    actorUserId: string,
    id: string,
    dto: TransitionFulfillmentDto,
  ): Promise<FulfillmentJob> {
    await this.prisma.$transaction(async (tx) => {
      const applied = await this.applyTransition(tx, actorUserId, id, dto.toStatus, {
        trackingReference: dto.trackingReference,
        failureReason: dto.failureReason,
      });
      if (!applied) {
        const existing = await tx.fulfillmentJob.findUnique({ where: { id } });
        if (!existing) {
          throw new NotFoundException("Fulfillment job not found");
        }
        throw new ConflictException(
          `Job is "${existing.status}" — cannot move to "${dto.toStatus}"`,
        );
      }
    });
    return this.prisma.fulfillmentJob.findUniqueOrThrow({
      where: { id },
      select: FULFILLMENT_JOB_SELECT,
    });
  }

  /** One transition applied across a print/post run. Jobs not in a valid
   * source state are skipped (not an error) so a bulk action over a mixed
   * selection does as much as it validly can. */
  async bulkTransition(
    actorUserId: string,
    dto: BulkTransitionFulfillmentDto,
  ): Promise<BulkTransitionSummary> {
    return this.prisma.$transaction(async (tx) => {
      let transitioned = 0;
      for (const id of dto.jobIds) {
        const applied = await this.applyTransition(tx, actorUserId, id, dto.toStatus, {
          trackingReference: dto.trackingReference,
        });
        if (applied) {
          transitioned += 1;
        }
      }
      return { transitioned, skipped: dto.jobIds.length - transitioned };
    });
  }

  /**
   * Atomically moves one job to `toStatus` (status-guarded, so a concurrent
   * transition can't double-apply) and propagates the change down to the
   * OrderRecipient, its Occasion, and up to the BatchOrder. Returns false if
   * the job wasn't in a valid source state (caller decides: throw vs skip).
   */
  private async applyTransition(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    id: string,
    toStatus: TransitionableStatus,
    opts: { trackingReference?: string; failureReason?: string },
  ): Promise<boolean> {
    const now = new Date();
    const jobData: Prisma.FulfillmentJobUpdateManyMutationInput = { status: toStatus };
    if (toStatus === "printed") jobData.printedAt = now;
    if (toStatus === "posted") {
      jobData.postedAt = now;
      if (opts.trackingReference) jobData.trackingReference = opts.trackingReference;
    }
    if (toStatus === "delivered") jobData.deliveredAt = now;

    const { count } = await tx.fulfillmentJob.updateMany({
      where: { id, status: { in: FROM_STATUSES[toStatus] } },
      data: jobData,
    });
    if (count === 0) {
      return false;
    }

    const job = await tx.fulfillmentJob.findUniqueOrThrow({
      where: { id },
      select: {
        orderRecipient: {
          select: {
            id: true,
            occasionId: true,
            batchOrderId: true,
            batchOrder: { select: { accountId: true } },
          },
        },
      },
    });
    const { orderRecipient } = job;

    // failed leaves the OrderRecipient/Occasion where they are (the card
    // couldn't be produced; a human decides what to do) — only the job and
    // the audit trail record it.
    if (toStatus !== "failed") {
      await tx.orderRecipient.update({
        where: { id: orderRecipient.id },
        data: { status: toStatus },
      });
      if (orderRecipient.occasionId) {
        await tx.occasion.update({
          where: { id: orderRecipient.occasionId },
          data: { status: toStatus },
        });
      }

      // The order enters "fulfilling" the moment its first card is printed,
      // and "completed" once every non-cancelled card is delivered.
      await tx.batchOrder.updateMany({
        where: { id: orderRecipient.batchOrderId, status: "paid" },
        data: { status: "fulfilling" },
      });
      if (toStatus === "delivered") {
        const outstanding = await tx.orderRecipient.count({
          where: {
            batchOrderId: orderRecipient.batchOrderId,
            status: { notIn: ["delivered", "cancelled"] },
          },
        });
        if (outstanding === 0) {
          await tx.batchOrder.updateMany({
            where: { id: orderRecipient.batchOrderId, status: "fulfilling" },
            data: { status: "completed" },
          });
        }
      }
    }

    await this.audit.record(
      {
        accountId: orderRecipient.batchOrder.accountId,
        actorUserId,
        action: `fulfillment_${toStatus}`,
        targetType: "FulfillmentJob",
        targetId: id,
        metadata: {
          ...(opts.trackingReference && { trackingReference: opts.trackingReference }),
          ...(opts.failureReason && { failureReason: opts.failureReason }),
        },
      },
      tx,
    );
    return true;
  }
}
