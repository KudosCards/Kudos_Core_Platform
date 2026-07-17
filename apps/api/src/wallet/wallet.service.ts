import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type WalletLedgerEntry } from "@prisma/client";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BatchOrdersService, type BatchOrder } from "../batch-orders/batch-orders.service";
import { STRIPE_CLIENT } from "../billing/stripe-client.provider";
import type { EnvConfig } from "../config/env.schema";
import type { CheckoutResult } from "../common/checkout-result";
import type { TopUpDto } from "./dto/top-up.dto";

const SERIALIZATION_FAILURE = "P2034";
/** No human is behind a Stripe webhook — see webhooks.service.ts. */
const SYSTEM_ACTOR = "system:stripe-webhook";

export interface WalletSummary {
  balanceMinor: number;
  currency: string;
  entries: WalletLedgerEntry[];
}

/**
 * The account wallet: a top-up-and-spend balance, backed by an append-only
 * ledger (WalletLedgerEntry). Balance is the SUM of entry amounts (topups
 * positive, charges negative) — order-independent and impossible to drift from
 * the ledger. All balance-changing writes run under Serializable isolation so
 * concurrent spends can't overdraw. See docs/adr/0012-wallet.md.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly batchOrders: BatchOrdersService,
  ) {}

  async getSummary(accountId: string): Promise<WalletSummary> {
    const [balanceMinor, entries] = await Promise.all([
      this.balanceOf(this.prisma, accountId),
      this.prisma.walletLedgerEntry.findMany({
        where: { accountId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
    return { balanceMinor, currency: "GBP", entries };
  }

  /** Starts a Stripe Checkout Session to add funds; the wallet is credited only
   * once the webhook confirms payment (see applyTopupFromSession). */
  async createTopUpCheckout(
    accountId: string,
    actorUserId: string,
    dto: TopUpDto,
  ): Promise<CheckoutResult> {
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "gbp",
            unit_amount: dto.amountMinor,
            product_data: { name: "Kudos Cards wallet top-up" },
          },
          quantity: 1,
        },
      ],
      success_url: `${webAppUrl}/wallet?topup=success`,
      cancel_url: `${webAppUrl}/wallet?topup=cancelled`,
      metadata: { type: "wallet_topup", accountId, amountMinor: String(dto.amountMinor) },
    });
    if (!session.url) {
      throw new ConflictException("Stripe did not return a checkout URL");
    }
    await this.audit.record({
      accountId,
      actorUserId,
      action: "wallet_topup_initiated",
      targetType: "Wallet",
      targetId: accountId,
      metadata: { amountMinor: dto.amountMinor },
    });
    return { checkoutUrl: session.url };
  }

  /**
   * Webhook-called credit. Idempotent on the Stripe session id (Stripe redelivers
   * webhooks at-least-once), so a second delivery is a safe no-op, never a
   * double top-up.
   */
  async applyTopupFromSession(session: Stripe.Checkout.Session): Promise<void> {
    const accountId = session.metadata?.accountId;
    const amountMinor = Number(session.metadata?.amountMinor);
    if (!accountId || !Number.isInteger(amountMinor) || amountMinor <= 0) {
      this.logger.error(`Malformed wallet_topup session ${session.id} — ignoring`);
      return;
    }

    const reference = `topup:${session.id}`;
    const credited = await this.runSerializable(async (tx) => {
      const existing = await tx.walletLedgerEntry.findFirst({ where: { accountId, reference } });
      if (existing) {
        return false; // already credited by an earlier delivery
      }
      const balance = await this.balanceOf(tx, accountId);
      await tx.walletLedgerEntry.create({
        data: {
          accountId,
          type: "topup",
          amountMinor,
          balanceAfterMinor: balance + amountMinor,
          reference,
        },
      });
      return true;
    });

    if (credited) {
      await this.audit.record({
        accountId,
        actorUserId: SYSTEM_ACTOR,
        action: "wallet_topup_succeeded",
        targetType: "Wallet",
        targetId: accountId,
        metadata: { amountMinor, stripeCheckoutSessionId: session.id },
      });
    }
  }

  /**
   * Pays a draft batch order from the wallet: debit the balance and settle the
   * order in one Serializable transaction, so two concurrent spends can't
   * overdraw and a paid order always has its fulfillment jobs. No Stripe call —
   * the funds are already on the platform.
   */
  async payOrder(accountId: string, actorUserId: string, batchOrderId: string): Promise<BatchOrder> {
    const order = await this.runSerializable(async (tx) => {
      const found = await tx.batchOrder.findFirst({ where: { id: batchOrderId, accountId } });
      if (!found) {
        throw new NotFoundException("Batch order not found");
      }
      if (found.status !== "draft") {
        throw new ConflictException(`Order is ${found.status}, not a draft awaiting payment`);
      }

      const balance = await this.balanceOf(tx, accountId);
      if (balance < found.totalMinor) {
        throw new ForbiddenException("Insufficient wallet balance");
      }

      await tx.walletLedgerEntry.create({
        data: {
          accountId,
          type: "charge",
          amountMinor: -found.totalMinor,
          balanceAfterMinor: balance - found.totalMinor,
          reference: `order:${batchOrderId}`,
        },
      });

      // Status-guarded so a concurrent card checkout / second wallet pay can't
      // pay the same order twice.
      const { count } = await tx.batchOrder.updateMany({
        where: { id: batchOrderId, accountId, status: "draft" },
        data: { status: "paid", paymentMethod: "wallet" },
      });
      if (count === 0) {
        throw new ConflictException("Order was already paid or changed by another request");
      }

      await this.batchOrders.settleFulfillment(tx, batchOrderId);
      return tx.batchOrder.findUniqueOrThrow({
        where: { id: batchOrderId },
        include: { orderRecipients: true },
      });
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "wallet_order_paid",
      targetType: "BatchOrder",
      targetId: batchOrderId,
      metadata: { totalMinor: order.totalMinor },
    });
    return order;
  }

  /** Balance = sum of all ledger amounts. Order-independent; can't drift. */
  private async balanceOf(
    client: PrismaService | Prisma.TransactionClient,
    accountId: string,
  ): Promise<number> {
    const { _sum } = await client.walletLedgerEntry.aggregate({
      where: { accountId },
      _sum: { amountMinor: true },
    });
    return _sum.amountMinor ?? 0;
  }

  /** Retries a Serializable transaction on a write-conflict (P2034) — the same
   * pattern recipients.service uses for cap enforcement. */
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
}
