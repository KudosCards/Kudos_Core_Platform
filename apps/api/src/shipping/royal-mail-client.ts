/**
 * Royal Mail Shipping API v4 (Click & Drop / Intersoft) client — creates a
 * shipment, buys the postage, and returns a tracking number (and, where
 * available, a label URL). We deliberately depend on a small interface, not the
 * raw wire format, so the fulfillment flow is testable with a mock and a real
 * provider can be swapped/verified independently. See
 * docs/adr/0072-royal-mail-shipping.md.
 */

export type RoyalMailPostageClass = "first_class" | "second_class";

export interface CreateShipmentInput {
  /** Our own reference for the shipment (the order number), echoed on RM. */
  orderReference: string;
  recipientName: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  postcode: string;
  /** ISO country; cards are UK ("GB") today. */
  country: string;
  postageClass: RoyalMailPostageClass;
}

export interface CreateShipmentResult {
  /** The Royal Mail tracking number allocated to the shipment. */
  trackingNumber: string;
  /** A URL to the printable label/QR, when the provider returns one. */
  labelUrl: string | null;
}

export interface RoyalMailClient {
  /** True when a real, credentialled client is wired (vs the no-op). */
  readonly enabled: boolean;
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
}

/** The customer-facing Royal Mail tracking page for a tracking number. */
export function royalMailTrackingUrl(trackingNumber: string): string {
  return `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(
    trackingNumber,
  )}`;
}

/**
 * Used when no ROYAL_MAIL_API_KEY is set: shipping automation is simply off, so
 * ops keep dispatching manually (marking posted + pasting their own tracking
 * from Click & Drop). Any attempt to auto-create a shipment fails loudly rather
 * than silently pretending — the dispatch endpoint checks `enabled` first.
 */
export class NoopRoyalMailClient implements RoyalMailClient {
  readonly enabled = false;
  createShipment(): Promise<CreateShipmentResult> {
    return Promise.reject(
      new Error("Royal Mail shipping is not configured (ROYAL_MAIL_API_KEY unset)"),
    );
  }
}

/** Default RM v4 service codes per postage class. Account-specific — confirm
 * against the live account before go-live (see ADR 0072/0096). Overridable via
 * ROYAL_MAIL_SERVICE_CODE_FIRST/SECOND without a redeploy. */
const DEFAULT_SERVICE_CODES: Record<RoyalMailPostageClass, string> = {
  first_class: "TPN01",
  second_class: "TPS01",
};

/** Per-postage-class service-code overrides (from env). */
export interface RoyalMailServiceCodes {
  first_class?: string;
  second_class?: string;
}

/** A card in a standard envelope: Large Letter weight band, in grams. */
const CARD_WEIGHT_GRAMS = 100;

/**
 * Real Shipping API v4 client. The request/response shape follows the
 * documented v4 structure, but the exact fields (service codes, weight units,
 * label retrieval) are account-specific and MUST be verified against Royal
 * Mail's sandbox before going live — same "verify after deploy" caveat as the
 * Stripe integration. The interface above is the stable contract the rest of
 * the app depends on.
 */
export class HttpRoyalMailClient implements RoyalMailClient {
  readonly enabled = true;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly serviceCodes: RoyalMailServiceCodes = {},
  ) {}

  /** The configured service code for a postage class, falling back to the
   * account-specific default. */
  private serviceCodeFor(postageClass: RoyalMailPostageClass): string {
    return this.serviceCodes[postageClass] ?? DEFAULT_SERVICE_CODES[postageClass];
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/v4/shipments`, {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        shipmentType: "Delivery",
        serviceCode: this.serviceCodeFor(input.postageClass),
        shipmentReference: input.orderReference,
        recipientContact: { name: input.recipientName },
        recipientAddress: {
          addressLine1: input.addressLine1,
          ...(input.addressLine2 ? { addressLine2: input.addressLine2 } : {}),
          city: input.city,
          postcode: input.postcode,
          countryCode: input.country,
        },
        packages: [{ weightInGrams: CARD_WEIGHT_GRAMS, packageType: "largeLetter" }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Royal Mail shipment failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    const data = (await response.json()) as {
      trackingNumber?: string;
      shipmentTrackingNumber?: string;
      labelUrl?: string;
      label?: { url?: string };
    };
    const trackingNumber = data.trackingNumber ?? data.shipmentTrackingNumber;
    if (!trackingNumber) {
      throw new Error("Royal Mail shipment response had no tracking number");
    }
    return { trackingNumber, labelUrl: data.labelUrl ?? data.label?.url ?? null };
  }
}
