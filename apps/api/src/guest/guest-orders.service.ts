import { Injectable } from "@nestjs/common";
import type { CheckoutResult } from "../common/checkout-result";
import { CLAIM_TOKEN_TTL_DAYS, generateClaimToken } from "../common/generate-claim-token";
import { PrismaService } from "../prisma/prisma.service";
import { CardDesignsService } from "../card-designs/card-designs.service";
import { SavedDesignsService } from "../saved-designs/saved-designs.service";
import { BatchOrdersService } from "../batch-orders/batch-orders.service";
import type { QuickSendDto } from "../batch-orders/dto/quick-send.dto";
import type { GuestCheckoutDto } from "./dto/guest-checkout.dto";
import type { GuestCartCheckoutDto, GuestCartItemDto } from "./dto/guest-cart-checkout.dto";

export interface GuestCheckoutResult extends CheckoutResult {
  orderId: string;
}

/**
 * Guest checkout: buy and send one or several personalised cards with no
 * account. The heavy lifting is deliberately delegated to the SAME money path
 * account holders use (BatchOrdersService.quickSend{,Many} + checkout) so
 * pricing, the approved→queued transition, and fulfilment can never drift into
 * a parallel copy — the only differences are that we mint a throwaway guest
 * account first and pass a null acting user. See docs/adr/0025.
 */
@Injectable()
export class GuestOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cardDesigns: CardDesignsService,
    private readonly savedDesigns: SavedDesignsService,
    private readonly batchOrders: BatchOrdersService,
  ) {}

  /** Single-card guest checkout — the one-item form of a basket checkout. */
  async checkout(dto: GuestCheckoutDto): Promise<GuestCheckoutResult> {
    return this.checkoutCart({
      buyerEmail: dto.buyerEmail,
      items: [
        {
          cardDesignId: dto.cardDesignId,
          document: dto.document,
          recipientFirstName: dto.recipientFirstName,
          recipientLastName: dto.recipientLastName,
          shippingAddressLine1: dto.shippingAddressLine1,
          shippingAddressLine2: dto.shippingAddressLine2,
          shippingAddressCity: dto.shippingAddressCity,
          shippingAddressPostcode: dto.shippingAddressPostcode,
          postageClass: dto.postageClass,
          occasionType: dto.occasionType,
        },
      ],
    });
  }

  /** Multi-card basket checkout: buy and send several personalised cards in one
   * payment. Mints one guest account, saves each card under it, and builds a
   * single batch order across every item — then one Stripe Checkout Session. */
  async checkoutCart(dto: GuestCartCheckoutDto): Promise<GuestCheckoutResult> {
    // Every chosen card must be a live template in the public catalog. Validate
    // all of them before minting anything, so a bad basket fails cleanly with no
    // orphaned guest account left behind.
    await Promise.all(dto.items.map((item) => this.cardDesigns.findOne(item.cardDesignId)));

    // Mint a fresh guest account — ALWAYS server-side. The DTO carries no
    // accountId, so a public caller can never aim an order at someone else's
    // account. `free` plan → no card discount → the flat £2.50 price. The claim
    // token is the credential that later lets the buyer attach a login.
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + CLAIM_TOKEN_TTL_DAYS);
    const claimToken = generateClaimToken();
    const account = await this.prisma.account.create({
      data: {
        type: "individual",
        name: "Guest",
        planId: "free",
        contactEmail: dto.buyerEmail,
        claimToken,
        claimTokenExpiresAt: expiresAt,
      },
    });

    // Save each personalised card under the guest account, then map it to the
    // guided-send input the money path consumes.
    const sends: QuickSendDto[] = [];
    for (const item of dto.items) {
      const savedDesign = await this.savedDesigns.create(account.id, {
        cardDesignId: item.cardDesignId,
        name: `Card for ${item.recipientFirstName} ${item.recipientLastName}`.slice(0, 120),
        document: item.document,
      });
      sends.push(this.toQuickSend(savedDesign.id, item));
    }

    // One batch order across every card. Null actor = guest (no createdByUserId,
    // no audit attribution).
    const order = await this.batchOrders.quickSendMany(account.id, null, sends);

    // Same race-safe Stripe Checkout as account holders, with the buyer's email
    // prefilled. Payment-before-fulfilment (webhook) is unchanged for guests.
    const { checkoutUrl } = await this.batchOrders.checkout(account.id, null, order.id, {
      customerEmail: dto.buyerEmail,
      successPath: "/gift/success",
      cancelPath: "/gift/cancelled",
      // The success page uses this to offer account-claiming right away.
      successExtraParams: { claim: claimToken },
    });

    return { checkoutUrl, orderId: order.id };
  }

  private toQuickSend(savedDesignId: string, item: GuestCartItemDto): QuickSendDto {
    return {
      savedDesignId,
      firstName: item.recipientFirstName,
      lastName: item.recipientLastName,
      shippingAddressLine1: item.shippingAddressLine1,
      shippingAddressLine2: item.shippingAddressLine2,
      shippingAddressCity: item.shippingAddressCity,
      shippingAddressPostcode: item.shippingAddressPostcode,
      postageClass: item.postageClass ?? "second_class",
      occasionType: item.occasionType,
    };
  }
}
