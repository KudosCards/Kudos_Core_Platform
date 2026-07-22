import { Injectable } from "@nestjs/common";
import type { CheckoutResult } from "../common/checkout-result";
import { CLAIM_TOKEN_TTL_DAYS, generateClaimToken } from "../common/generate-claim-token";
import { PrismaService } from "../prisma/prisma.service";
import { CardDesignsService } from "../card-designs/card-designs.service";
import { SavedDesignsService } from "../saved-designs/saved-designs.service";
import { BatchOrdersService } from "../batch-orders/batch-orders.service";
import type { GuestCheckoutDto } from "./dto/guest-checkout.dto";

export interface GuestCheckoutResult extends CheckoutResult {
  orderId: string;
}

/**
 * Guest one-off checkout: buy and send a single personalised card with no
 * account. The heavy lifting is deliberately delegated to the SAME money path
 * account holders use (BatchOrdersService.quickSend + checkout) so pricing, the
 * approved→queued transition, and fulfilment can never drift into a parallel
 * copy — the only differences are that we mint a throwaway guest account first
 * and pass a null acting user. See docs/adr/0025.
 */
@Injectable()
export class GuestOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cardDesigns: CardDesignsService,
    private readonly savedDesigns: SavedDesignsService,
    private readonly batchOrders: BatchOrdersService,
  ) {}

  async checkout(dto: GuestCheckoutDto): Promise<GuestCheckoutResult> {
    // The chosen card must be a live template in the public catalog.
    const design = await this.cardDesigns.findOne(dto.cardDesignId);

    // Mint a fresh guest account — ALWAYS server-side. The DTO carries no
    // accountId, so a public caller can never aim an order at someone else's
    // account. `free` plan → no card discount → the flat £1.50 price. The claim
    // token is the credential that later lets the buyer attach a login.
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + CLAIM_TOKEN_TTL_DAYS);
    const account = await this.prisma.account.create({
      data: {
        type: "individual",
        name: "Guest",
        planId: "free",
        contactEmail: dto.buyerEmail,
        claimToken: generateClaimToken(),
        claimTokenExpiresAt: expiresAt,
      },
    });

    // The personalised card, saved under the guest account.
    const savedDesign = await this.savedDesigns.create(account.id, {
      cardDesignId: design.id,
      name: `Card for ${dto.recipientFirstName} ${dto.recipientLastName}`.slice(0, 120),
      document: dto.document,
    });

    // Reuse the exact guided-send money path: recipient + approved occasion +
    // draft order. Null actor = guest (no createdByUserId, no audit attribution).
    const order = await this.batchOrders.quickSend(account.id, null, {
      savedDesignId: savedDesign.id,
      firstName: dto.recipientFirstName,
      lastName: dto.recipientLastName,
      shippingAddressLine1: dto.shippingAddressLine1,
      shippingAddressLine2: dto.shippingAddressLine2,
      shippingAddressCity: dto.shippingAddressCity,
      shippingAddressPostcode: dto.shippingAddressPostcode,
      postageClass: dto.postageClass ?? "second_class",
      occasionType: dto.occasionType,
    });

    // Same race-safe Stripe Checkout as account holders, with the buyer's email
    // prefilled. Payment-before-fulfilment (webhook) is unchanged for guests.
    const { checkoutUrl } = await this.batchOrders.checkout(account.id, null, order.id, {
      customerEmail: dto.buyerEmail,
      successPath: "/gift/success",
      cancelPath: "/gift/cancelled",
    });

    return { checkoutUrl, orderId: order.id };
  }
}
