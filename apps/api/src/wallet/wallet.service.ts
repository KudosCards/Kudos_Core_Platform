import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type WalletCampaign, type WalletLedgerEntry } from "@prisma/client";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BatchOrdersService, type BatchOrder } from "../batch-orders/batch-orders.service";
import { STRIPE_CLIENT } from "../billing/stripe-client.provider";
import type { EnvConfig } from "../config/env.schema";
import type { CheckoutResult } from "../common/checkout-result";
import { runSerializable } from "../common/run-serializable";
import { OpsActivityService } from "../ops-activity/ops-activity.service";
import type { TopUpDto } from "./dto/top-up.dto";
import type { AutoTopUpDto } from "./dto/auto-top-up.dto";
import { type AutoTopUpPauseReason, pauseReasonOfStripeError } from "./auto-top-up";

/** No human is behind a Stripe webhook — see webhooks.service.ts. */
const SYSTEM_ACTOR = "system:stripe-webhook";
/** Nor behind an automatic top-up: the customer authorised the standing
 * instruction, not this particular charge. */
const SYSTEM_ACTOR_AUTO_TOP_UP = "system:wallet-auto-top-up";
/** Campaign credits are granted by the platform, not by the operator who
 *  happened to create the campaign — the campaign id in the metadata is what
 *  ties a credit back to a person's decision. */
const SYSTEM_ACTOR_CAMPAIGN = "system:wallet-campaign";

/**
 * What a campaign credit did. A result rather than an exception, because the
 * caller is a sweep over many accounts: ADR 0186's rule is that one account
 * that cannot be credited must not take the batch down, and "already credited"
 * and "out of budget" are ordinary outcomes rather than failures at all.
 */
export type CampaignCreditOutcome =
  | { status: "credited"; amountMinor: number }
  /** This account already has a campaign credit — this one or an earlier one. */
  | { status: "already_credited" }
  | { status: "budget_exhausted" }
  | {
      status: "not_eligible";
      reason:
        | "campaign_not_live"
        | "campaign_missing"
        | "outside_window"
        | "email_unverified"
        | "account_missing";
    };

/** The prefix every campaign credit's ledger `reference` carries, so one
 *  account's campaign credit can be found without knowing which campaign. */
export const CAMPAIGN_REFERENCE_PREFIX = "campaign:";

/** The ledger reference a given campaign's credits carry. */
export function campaignReference(campaignId: string): string {
  return `${CAMPAIGN_REFERENCE_PREFIX}${campaignId}`;
}

/** The standing top-up instruction as the customer sees it. `pausedReason` is
 * the code, not a sentence — the web app owns the wording, the same way the
 * inbox copy does. */
export interface AutoTopUpSettings {
  enabled: boolean;
  thresholdMinor: number;
  amountMinor: number;
  pausedAt: Date | null;
  pausedReason: string | null;
}

export interface WalletSummary {
  balanceMinor: number;
  currency: string;
  entries: WalletLedgerEntry[];
  autoTopUp: AutoTopUpSettings;
}

/**
 * What one attempt at an automatic top-up did. A result rather than an
 * exception, for the same reason `CampaignCreditOutcome` is one: the caller is
 * a sweep over many accounts, and "switched off" and "already funded" are
 * ordinary outcomes rather than failures at all.
 */
export type AutoTopUpOutcome =
  | { status: "topped_up"; amountMinor: number; balanceAfterMinor: number }
  /** Above the threshold — nothing to do. */
  | { status: "not_needed"; balanceMinor: number }
  | { status: "disabled" }
  /** Already paused by an earlier failure; waiting on the customer. */
  | { status: "paused" }
  | { status: "failed"; reason: AutoTopUpPauseReason; detail: string };

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
    private readonly opsActivity: OpsActivityService,
  ) {}

  async getSummary(accountId: string): Promise<WalletSummary> {
    const [balanceMinor, entries, account] = await Promise.all([
      this.balanceOf(this.prisma, accountId),
      this.prisma.walletLedgerEntry.findMany({
        where: { accountId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.account.findUniqueOrThrow({
        where: { id: accountId },
        select: {
          autoTopUpEnabled: true,
          autoTopUpThresholdMinor: true,
          autoTopUpAmountMinor: true,
          autoTopUpPausedAt: true,
          autoTopUpPausedReason: true,
        },
      }),
    ]);
    return {
      balanceMinor,
      currency: "GBP",
      entries,
      autoTopUp: {
        enabled: account.autoTopUpEnabled,
        thresholdMinor: account.autoTopUpThresholdMinor,
        amountMinor: account.autoTopUpAmountMinor,
        pausedAt: account.autoTopUpPausedAt,
        pausedReason: account.autoTopUpPausedReason,
      },
    };
  }

  /**
   * Set the standing instruction.
   *
   * Always clears the pause. A customer arriving here has either just fixed
   * their card or is switching the whole thing off, and both mean the old
   * failure is no longer the reason to refuse to try.
   */
  async updateAutoTopUp(
    accountId: string,
    actorUserId: string,
    dto: AutoTopUpDto,
  ): Promise<WalletSummary> {
    await this.prisma.account.update({
      where: { id: accountId },
      data: {
        autoTopUpEnabled: dto.enabled,
        autoTopUpThresholdMinor: dto.thresholdMinor,
        autoTopUpAmountMinor: dto.amountMinor,
        autoTopUpPausedAt: null,
        autoTopUpPausedReason: null,
      },
    });
    await this.audit.record({
      accountId,
      actorUserId,
      action: dto.enabled ? "wallet_auto_topup_enabled" : "wallet_auto_topup_disabled",
      targetType: "Wallet",
      targetId: accountId,
      metadata: { thresholdMinor: dto.thresholdMinor, amountMinor: dto.amountMinor },
    });
    return this.getSummary(accountId);
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
  private async fetchTopupReceipt(session: Stripe.Checkout.Session): Promise<{
    stripeInvoiceId?: string;
    receiptUrl?: string | null;
    receiptPdfUrl?: string | null;
  }> {
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

  /** The account's current balance. The ledger's sum, same as everywhere else —
   * exposed because the wallet watch needs it without the recent entries. */
  async getBalance(accountId: string): Promise<number> {
    return this.balanceOf(this.prisma, accountId);
  }

  /**
   * One attempt at the standing instruction: if the balance has fallen below
   * the account's threshold, charge the stored card for the account's amount
   * and credit the wallet.
   *
   * Self-contained on purpose. The caller has already filtered in SQL, but the
   * guards that matter — switched on, not paused, actually below the threshold
   * — are re-checked here so they cannot be forgotten at a second call site.
   *
   * Billed through a Stripe **invoice** rather than a bare PaymentIntent, so an
   * automatic top-up produces the same VAT receipt a manual one does. ADR 0103
   * promised a receipt for the money a wallet customer actually pays, and this
   * is the same taxable purchase arriving by a different door.
   */
  async autoTopUp(accountId: string): Promise<AutoTopUpOutcome> {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: {
        name: true,
        stripeCustomerId: true,
        autoTopUpEnabled: true,
        autoTopUpPausedAt: true,
        autoTopUpThresholdMinor: true,
        autoTopUpAmountMinor: true,
      },
    });
    if (!account.autoTopUpEnabled) return { status: "disabled" };
    if (account.autoTopUpPausedAt) return { status: "paused" };

    const balanceMinor = await this.balanceOf(this.prisma, accountId);
    if (balanceMinor >= account.autoTopUpThresholdMinor) {
      return { status: "not_needed", balanceMinor };
    }

    // No Stripe customer means no card, and creating one here would only
    // manufacture an empty customer to fail against a moment later.
    if (!account.stripeCustomerId) {
      return { status: "failed", reason: "no_payment_method", detail: "No Stripe customer" };
    }
    const paymentMethodId = await this.resolveCardPaymentMethod(account.stripeCustomerId);
    if (!paymentMethodId) {
      return { status: "failed", reason: "no_payment_method", detail: "No usable card on file" };
    }

    const amountMinor = account.autoTopUpAmountMinor;
    let invoice: Stripe.Invoice;
    try {
      invoice = await this.chargeAutoTopUp(
        account.stripeCustomerId,
        paymentMethodId,
        accountId,
        amountMinor,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { status: "failed", reason: pauseReasonOfStripeError(error), detail };
    }

    // Past this line the money has moved. A credit that does not land is not a
    // failure to retry — retrying would charge them twice — so it is raised
    // with Kudos HQ naming the invoice, for an operator to credit by hand.
    try {
      const balanceAfterMinor = await this.creditAutoTopUp(accountId, amountMinor, invoice);
      await this.audit.record({
        accountId,
        actorUserId: SYSTEM_ACTOR_AUTO_TOP_UP,
        action: "wallet_auto_topup_succeeded",
        targetType: "Wallet",
        targetId: accountId,
        metadata: { amountMinor, stripeInvoiceId: invoice.id },
      });
      return { status: "topped_up", amountMinor, balanceAfterMinor };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Auto top-up for account ${accountId} charged invoice ${invoice.id} but did not credit: ${detail}`,
      );
      await this.opsActivity.walletTopUpNotCredited(accountId, invoice.id, amountMinor, detail);
      throw error;
    }
  }

  /** Create, finalise and pay a one-line invoice for the top-up. Split out so
   * the "money has moved" boundary above is a single, obvious line. */
  private async chargeAutoTopUp(
    customerId: string,
    paymentMethodId: string,
    accountId: string,
    amountMinor: number,
  ): Promise<Stripe.Invoice> {
    const draft = await this.stripe.invoices.create({
      customer: customerId,
      collection_method: "charge_automatically",
      // We finalise and pay it ourselves below, in this one run, so we know the
      // outcome in time to decide whether to pause.
      auto_advance: false,
      // Only the line we are about to add. Without this, any unrelated pending
      // invoice item on the customer would be swept onto this invoice and
      // charged as part of a "top-up" the customer never asked for.
      pending_invoice_items_behavior: "exclude",
      description: "Kudos Cards wallet top-up (automatic)",
      metadata: { type: "wallet_auto_topup", accountId, amountMinor: String(amountMinor) },
    });
    await this.stripe.invoiceItems.create({
      customer: customerId,
      invoice: draft.id,
      amount: amountMinor,
      currency: "gbp",
      description: "Kudos Cards wallet top-up",
    });
    const finalized = await this.stripe.invoices.finalizeInvoice(draft.id);
    return this.stripe.invoices.pay(finalized.id, {
      payment_method: paymentMethodId,
      off_session: true,
    });
  }

  /** Credit the wallet for a paid auto top-up, idempotent on the invoice id,
   * capturing the VAT receipt in the same create (ADR 0103). Returns the
   * balance the account now has. */
  private async creditAutoTopUp(
    accountId: string,
    amountMinor: number,
    invoice: Stripe.Invoice,
  ): Promise<number> {
    const reference = `topup:${invoice.id}`;
    return runSerializable(this.prisma, async (tx) => {
      const existing = await tx.walletLedgerEntry.findFirst({ where: { accountId, reference } });
      if (existing) {
        return existing.balanceAfterMinor;
      }
      const balance = await this.balanceOf(tx, accountId);
      const balanceAfterMinor = balance + amountMinor;
      await tx.walletLedgerEntry.create({
        data: {
          accountId,
          type: "topup",
          amountMinor,
          balanceAfterMinor,
          reference,
          stripeInvoiceId: invoice.id,
          receiptUrl: invoice.hosted_invoice_url ?? null,
          receiptPdfUrl: invoice.invoice_pdf ?? null,
        },
      });
      return balanceAfterMinor;
    });
  }

  /**
   * A card of the customer's we can charge unattended, or null.
   *
   * Prefers whatever Stripe already treats as their default — for a Pro
   * subscriber that is the card paying for Pro — and otherwise takes the most
   * recently attached. Expired cards are dropped before we try: "a stored card
   * that is active" was the requirement, and charging a card that cannot work
   * only turns a clear "add a card" into a confusing decline.
   */
  private async resolveCardPaymentMethod(customerId: string): Promise<string | null> {
    const methods = await this.stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
      limit: 20,
    });
    const usable = methods.data.filter((method) => !this.cardHasExpired(method.card));
    if (usable.length === 0) {
      return null;
    }

    const customer = await this.stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return null;
    }
    const preferred = customer.invoice_settings?.default_payment_method;
    const preferredId = typeof preferred === "string" ? preferred : (preferred?.id ?? null);
    if (preferredId && usable.some((method) => method.id === preferredId)) {
      return preferredId;
    }
    // `paymentMethods.list` returns newest first.
    return usable[0]?.id ?? null;
  }

  /** A card is good until the end of its expiry month. */
  private cardHasExpired(card: Stripe.PaymentMethod.Card | undefined): boolean {
    if (!card) return true;
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    return card.exp_year < year || (card.exp_year === year && card.exp_month < month);
  }

  /**
   * Pays a draft batch order from the wallet: debit the balance and settle the
   * order in one Serializable transaction, so two concurrent spends can't
   * overdraw and a paid order always has its fulfillment jobs. No Stripe call —
   * the funds are already on the platform.
   */
  async payOrder(
    accountId: string,
    actorUserId: string,
    batchOrderId: string,
  ): Promise<BatchOrder> {
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
    // Kudos HQ's copy — post-commit, like the audit entry above. A wallet
    // payment never touches Stripe, so the webhook path would never see it.
    await this.opsActivity.orderPaid(batchOrderId);
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

  /**
   * Credit or debit an account's wallet by hand — a goodwill gesture, or a
   * correction to one.
   *
   * An `adjustment` entry, which the ledger was designed for but nothing had
   * ever written: the schema is append-only precisely so a correction is a new
   * row rather than an edit, and this is the path that uses it.
   *
   * Debits are allowed because a credit-only tool has no remedy for its own
   * mistakes — the first mistyped amount would otherwise need a hand-written SQL
   * statement against a ledger whose whole point is that nobody does that. A
   * debit may not take the balance below zero: money already spent on cards has
   * gone to physical work, and an overdrawn wallet is not a state any other part
   * of the system is written to expect.
   *
   * Idempotent on `requestId`, like the top-up path. A duplicate credit is not
   * self-correcting — someone has to notice it and reverse it — so a
   * double-submitted form must not be able to cause one.
   *
   * Serializable, like every other balance write, so it cannot interleave with a
   * concurrent order payment and compute its balance from a stale read.
   */
  async adjustBalance(
    accountId: string,
    actorUserId: string,
    input: { amountMinor: number; reason: string; requestId: string },
  ): Promise<WalletSummary> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException("Customer not found");
    }

    const reference = `adjustment:${input.requestId}`;
    const applied = await runSerializable(this.prisma, async (tx) => {
      const existing = await tx.walletLedgerEntry.findFirst({ where: { accountId, reference } });
      if (existing) {
        return false; // this same adjustment has already been applied
      }
      const balance = await this.balanceOf(tx, accountId);
      if (balance + input.amountMinor < 0) {
        throw new ConflictException(
          `That would take the balance below zero (currently ${balance} pence).`,
        );
      }
      await tx.walletLedgerEntry.create({
        data: {
          accountId,
          type: "adjustment",
          amountMinor: input.amountMinor,
          balanceAfterMinor: balance + input.amountMinor,
          reference,
        },
      });
      return true;
    });

    if (applied) {
      // Deliberately not fire-and-forget: this moves money on a customer's
      // account with no payment behind it, so who did it and why is the record
      // that makes it defensible.
      await this.audit.record({
        accountId,
        actorUserId,
        action: "wallet_adjustment_applied",
        targetType: "Wallet",
        targetId: accountId,
        metadata: {
          amountMinor: input.amountMinor,
          reason: input.reason,
          requestId: input.requestId,
        },
      });
    }
    return this.getSummary(accountId);
  }

  /**
   * Credit one account from a marketing wallet campaign.
   *
   * Every check that decides whether money moves happens **inside the same
   * serializable transaction as the write**, because each of them is a
   * read-then-write and this is money with no payment behind it:
   *
   * - **Budget.** Outside the transaction, two accounts signing up together
   *   both read "£5 left" and both take it. This is the whole reason the budget
   *   is a control rather than a hope.
   * - **One credit per account, ever** — not per campaign. Two campaigns with
   *   overlapping windows would otherwise both match an account created in the
   *   overlap, and nobody plans to pay a welcome gift twice. It costs nothing
   *   to enforce, because an account can only be new once.
   * - **The window**, half-open on `createdAt`, so an account on the boundary
   *   belongs to exactly one day's campaign.
   *
   * `verifiedEmail` is a required argument rather than something read in here,
   * and null means "not verified" exactly as `verifiedEmailFromToken` returns.
   * The two callers establish it differently — the signup path from the request
   * JWT, the sweep from an authoritative Supabase lookup — and making it an
   * argument means a third caller has to say which it has rather than
   * accidentally skipping the question. With a campaign live, the address
   * decides £5. See ADR 0188 and docs/wallet-campaigns-plan.md.
   *
   * The audit entry is written **inside** the transaction, unlike
   * `adjustBalance` above, which writes it after. ADR 0229 settled that
   * argument for the date-of-birth edit and it applies harder here: a credit
   * that commits without the row saying who authorised it is money with no
   * record. The older path is a known inconsistency, noted rather than changed
   * as a side effect of this work.
   */
  async creditCampaign(
    accountId: string,
    campaign: WalletCampaign,
    verifiedEmail: string | null,
  ): Promise<CampaignCreditOutcome> {
    // Cheap refusals on what the caller already holds, to avoid opening a
    // transaction for an answer that cannot change to "yes". Neither is
    // authoritative: `status` is re-read inside, and a campaign that has since
    // gone live is one the *next* sweep credits.
    if (campaign.status !== "live") {
      return { status: "not_eligible", reason: "campaign_not_live" };
    }
    if (!verifiedEmail) {
      return { status: "not_eligible", reason: "email_unverified" };
    }

    const reference = campaignReference(campaign.id);
    return runSerializable(this.prisma, async (tx): Promise<CampaignCreditOutcome> => {
      // The campaign as it stands now, not as the caller read it.
      //
      // The sweep reads its campaigns once and then works a batch of up to 200
      // accounts from that one row — minutes of crediting from a snapshot taken
      // at the start. An operator who presses Pause during that batch has said
      // stop, and every field that decides this outcome has to come from the
      // same read as the spend it is compared against, or the money moves on a
      // decision already reversed.
      //
      // Reading it in here is also what makes Serializable do the work: the
      // read conflicts with the operator's write, so one of the two aborts and
      // retries against the settled value instead of racing it.
      const current = await tx.walletCampaign.findUnique({ where: { id: campaign.id } });
      if (!current) {
        return { status: "not_eligible", reason: "campaign_missing" };
      }
      if (current.status !== "live") {
        return { status: "not_eligible", reason: "campaign_not_live" };
      }

      const account = await tx.account.findUnique({
        where: { id: accountId },
        select: { createdAt: true },
      });
      if (!account) {
        return { status: "not_eligible", reason: "account_missing" };
      }
      // Half-open: [startsAt, endsAt).
      if (account.createdAt < current.startsAt || account.createdAt >= current.endsAt) {
        return { status: "not_eligible", reason: "outside_window" };
      }

      const existing = await tx.walletLedgerEntry.findFirst({
        where: { accountId, reference: { startsWith: CAMPAIGN_REFERENCE_PREFIX } },
        select: { id: true },
      });
      if (existing) {
        return { status: "already_credited" };
      }

      const { _sum } = await tx.walletLedgerEntry.aggregate({
        where: { reference },
        _sum: { amountMinor: true },
      });
      const spent = _sum.amountMinor ?? 0;
      if (spent + current.amountMinor > current.budgetMinor) {
        return { status: "budget_exhausted" };
      }

      const balance = await this.balanceOf(tx, accountId);
      await tx.walletLedgerEntry.create({
        data: {
          accountId,
          type: "campaign",
          amountMinor: current.amountMinor,
          balanceAfterMinor: balance + current.amountMinor,
          reference,
        },
      });
      await this.audit.record(
        {
          accountId,
          actorUserId: SYSTEM_ACTOR_CAMPAIGN,
          action: "wallet_campaign_credited",
          targetType: "Wallet",
          targetId: accountId,
          metadata: {
            campaignId: current.id,
            campaignName: current.name,
            amountMinor: current.amountMinor,
          },
        },
        tx,
      );
      return { status: "credited", amountMinor: current.amountMinor };
    });
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
