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
import { runSerializable } from "../common/run-serializable";
import type { TopUpDto } from "./dto/top-up.dto";

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
      // No `payment_method_types` — omitting it lets Stripe-hosted Checkout
      // present every Dashboard-enabled method (incl. the Apple Pay / Google Pay
      // / Link wallets), so a top-up can be paid with Apple Pay too. The wallet
      // is credited only on a confirmed (payment_status "paid") session — see
      // applyTopupFromSession + the webhook guard — so a delayed method can never
      // credit before we're paid. See docs/adr/0126-checkout-payment-methods.md.
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
      // Have Stripe generate a VAT invoice for the top-up, using the account's
      // business/VAT settings — the same source as every other receipt. Captured
      // onto the ledger entry when the top-up is credited (see
      // applyTopupFromSession). See docs/adr/0103-wallet-topup-receipts.md.
      invoice_creation: { enabled: true },
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
    // Capture Stripe's generated VAT invoice (PDF + hosted URL) for the top-up so
    // the customer can download a receipt. Read here at credit time — the ledger
    // entry is created lazily, so there's no pre-existing row for the invoice.paid
    // webhook to update reliably; fetching it now is race-free. Best-effort: a
    // retrieve failure just leaves the receipt unset (the Stripe email is the
    // backstop) and never blocks the credit. See ADR 0103.
    const receipt = await this.fetchTopupReceipt(session);
    const credited = await runSerializable(this.prisma, async (tx) => {
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
          ...receipt,
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

  /** The top-up's Stripe VAT invoice (id + hosted URL + PDF), or an empty object
   * when there's no invoice or the lookup fails. Best-effort — the caller stores
   * whatever comes back and never fails the credit over a receipt. */
  private async fetchTopupReceipt(
    session: Stripe.Checkout.Session,
  ): Promise<{ stripeInvoiceId?: string; receiptUrl?: string | null; receiptPdfUrl?: string | null }> {
    const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id;
    if (!invoiceId) {
      return {};
    }
    try {
      const invoice = await this.stripe.invoices.retrieve(invoiceId);
      return {
        stripeInvoiceId: invoice.id,
        receiptUrl: invoice.hosted_invoice_url ?? null,
        receiptPdfUrl: invoice.invoice_pdf ?? null,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Top-up invoice lookup for session ${session.id} failed: ${reason}`);
      return {};
    }
  }

  /**
   * Pays a draft batch order from the wallet: debit the balance and settle the
   * order in one Serializable transaction, so two concurrent spends can't
   * overdraw and a paid order always has its fulfillment jobs. No Stripe call —
   * the funds are already on the platform.
   */
  async payOrder(accountId: string, actorUserId: string, batchOrderId: string): Promise<BatchOrder> {
    const order = await runSerializable(this.prisma, async (tx) => {
      await this.debitAndSettleOrder(tx, accountId, batchOrderId);
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

  /**
   * Debits the wallet for a draft order and settles its fulfilment — the shared
   * core of every wallet payment, whether interactive (payOrder) or unattended
   * (auto-send). MUST run inside a Serializable transaction so the balance read
   * and the debit can't race a concurrent spend. Throws ForbiddenException on
   * insufficient funds and ConflictException if the order isn't a payable draft;
   * either rolls back the caller's transaction. Does not audit — the caller does,
   * with its own actor.
   */
  async debitAndSettleOrder(
    tx: Prisma.TransactionClient,
    accountId: string,
    batchOrderId: string,
  ): Promise<void> {
    const order = await tx.batchOrder.findFirst({ where: { id: batchOrderId, accountId } });
    if (!order) {
      throw new NotFoundException("Batch order not found");
    }
    if (order.status !== "draft") {
      throw new ConflictException(`Order is ${order.status}, not a draft awaiting payment`);
    }

    const balance = await this.balanceOf(tx, accountId);
    if (balance < order.totalMinor) {
      throw new ForbiddenException("Insufficient wallet balance");
    }

    await tx.walletLedgerEntry.create({
      data: {
        accountId,
        type: "charge",
        amountMinor: -order.totalMinor,
        balanceAfterMinor: balance - order.totalMinor,
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
}
