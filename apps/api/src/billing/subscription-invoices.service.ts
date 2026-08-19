import { Inject, Injectable, Logger } from "@nestjs/common";
import type Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { STRIPE_CLIENT } from "./stripe-client.provider";

/** What happened to one invoice we were offered. */
export type SubscriptionInvoiceOutcome = "recorded" | "not-subscription" | "unmatched";

export interface SubscriptionInvoiceBackfillSummary {
  /** Paid invoices read from Stripe. */
  scanned: number;
  /** Subscription invoices written (created or refreshed). */
  recorded: number;
  /** Skipped — not attributed to a subscription (card orders, one-offs). */
  notSubscription: number;
  /** Subscription invoices we could not match to an account. */
  unmatched: number;
  /** True when Stripe still had more pages at the page cap. */
  truncated: boolean;
}

/** Stripe's maximum page size, so the fewest possible round trips. */
const PAGE_SIZE = 100;
/**
 * Hard stop on pages, so a misconfiguration can't loop forever. 200 pages is
 * 20,000 invoices — far beyond anything this platform has, and the summary says
 * plainly when it's hit rather than pretending it finished.
 */
const MAX_PAGES = 200;

/**
 * Subscription income, written down.
 *
 * Both the live webhook and the historical backfill go through `record()` —
 * deliberately one implementation, because two would drift and the difference
 * would show up as money that doesn't reconcile. The backfill is safe to run at
 * any time, including while webhooks are arriving: every write is an upsert on
 * Stripe's invoice id, so the two paths converge on the same row instead of
 * double-counting.
 */
@Injectable()
export class SubscriptionInvoicesService {
  private readonly logger = new Logger(SubscriptionInvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  /**
   * Record one paid invoice, if it's subscription income.
   *
   * Returns what it decided rather than throwing, so the backfill can count
   * outcomes and the webhook can stay quiet — a bookkeeping problem must never
   * make Stripe retry a payment we've already handled.
   */
  async record(invoice: Stripe.Invoice): Promise<SubscriptionInvoiceOutcome> {
    // `invoice.subscription` doesn't exist in this SDK — the link moved to
    // `parent.subscription_details`. No subscription behind it means it isn't
    // subscription income and doesn't belong in this table.
    const subscription = invoice.parent?.subscription_details?.subscription;
    const stripeSubscriptionId =
      typeof subscription === "string" ? subscription : (subscription?.id ?? null);
    if (!stripeSubscriptionId) {
      return "not-subscription";
    }

    const stripeCustomerId = stripeCustomerIdOf(invoice);
    const accountId = await this.resolveAccountId(stripeCustomerId, stripeSubscriptionId);
    if (!accountId) {
      // Loud, not silent: an invoice we can't place is revenue missing from a
      // customer's record, and nothing else would surface it.
      this.logger.warn(
        `Paid subscription invoice ${invoice.id} could not be matched to an account ` +
          `(customer ${stripeCustomerId ?? "none"}, subscription ${stripeSubscriptionId})`,
      );
      return "unmatched";
    }

    const paidAt = invoice.status_transitions.paid_at;
    const data = {
      accountId,
      stripeSubscriptionId,
      // amount_paid, not total: a partly-paid or credited invoice must not count
      // as if it were paid in full.
      amountPaidMinor: invoice.amount_paid,
      currency: invoice.currency,
      status: invoice.status ?? "paid",
      billingReason: invoice.billing_reason ?? null,
      periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
      periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
      // Stripe's own paid timestamp, so a backfilled invoice lands on the date it
      // was actually paid rather than the day we imported it.
      paidAt: paidAt ? new Date(paidAt * 1000) : new Date(invoice.created * 1000),
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdfUrl: invoice.invoice_pdf ?? null,
    };

    await this.prisma.subscriptionInvoice.upsert({
      where: { stripeInvoiceId: invoice.id },
      create: { ...data, stripeInvoiceId: invoice.id },
      update: data,
    });
    return "recorded";
  }

  /**
   * Read every paid invoice Stripe holds and record the subscription ones.
   *
   * Stripe is the source of truth here, not our webhook history: this is what
   * fills in everything billed before capture existed, and what repairs a gap
   * left by a webhook we missed or an outage. Re-runnable by design — nothing
   * accumulates on a second pass.
   */
  async backfill(): Promise<SubscriptionInvoiceBackfillSummary> {
    const summary: SubscriptionInvoiceBackfillSummary = {
      scanned: 0,
      recorded: 0,
      notSubscription: 0,
      unmatched: 0,
      truncated: false,
    };

    let startingAfter: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await this.stripe.invoices.list({
        status: "paid",
        limit: PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const invoice of response.data) {
        summary.scanned += 1;
        try {
          const outcome = await this.record(invoice);
          if (outcome === "recorded") summary.recorded += 1;
          else if (outcome === "unmatched") summary.unmatched += 1;
          else summary.notSubscription += 1;
        } catch (error) {
          // One bad invoice must not abandon the rest of the history.
          const reason = error instanceof Error ? error.message : "Unknown error";
          this.logger.error(`Backfilling invoice ${invoice.id} failed: ${reason}`);
        }
      }

      if (!response.has_more) {
        this.logger.log(
          `Subscription invoice backfill: scanned ${summary.scanned}, recorded ${summary.recorded}, ` +
            `not-subscription ${summary.notSubscription}, unmatched ${summary.unmatched}`,
        );
        return summary;
      }
      startingAfter = response.data.at(-1)?.id;
      if (!startingAfter) {
        // has_more with an empty page shouldn't happen; stop rather than spin.
        return summary;
      }
    }

    summary.truncated = true;
    this.logger.warn(
      `Subscription invoice backfill stopped at the ${MAX_PAGES}-page cap with more to read`,
    );
    return summary;
  }

  /**
   * The account an invoice belongs to: by Stripe customer first (the durable
   * link), falling back to the subscription we already track — which covers an
   * account whose `stripeCustomerId` was never stored.
   */
  private async resolveAccountId(
    stripeCustomerId: string | null,
    stripeSubscriptionId: string,
  ): Promise<string | null> {
    if (stripeCustomerId) {
      const account = await this.prisma.account.findUnique({
        where: { stripeCustomerId },
        select: { id: true },
      });
      if (account) return account.id;
    }
    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
      select: { accountId: true },
    });
    return subscription?.accountId ?? null;
  }
}

/** An invoice's Stripe customer id, whether Stripe expanded the object or not.
 *  A deleted customer has no usable id. */
function stripeCustomerIdOf(invoice: Stripe.Invoice): string | null {
  const customer = invoice.customer;
  if (typeof customer === "string") return customer;
  if (!customer || customer.deleted) return null;
  return customer.id;
}
