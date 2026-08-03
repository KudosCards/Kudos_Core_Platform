/**
 * Royal Mail Click & Drop *Orders API* client — imports an order (one card) into
 * the operator's Click & Drop dashboard queue, where they batch, buy postage,
 * print labels and dispatch. This is a different product from the Shipping API v4
 * (`royal-mail-client.ts`), which instead creates a finished shipment
 * server-side. We depend on a small interface, not the raw wire format, so the
 * import flow is testable with a mock. See docs/adr/0095-click-and-drop-import.md.
 *
 * IMPORTANT: the request/response shape follows Royal Mail's documented Click &
 * Drop API, but the exact fields, auth scheme, weight/format identifiers and
 * service codes are account-specific and MUST be verified against the live API
 * after deploy with the real key — the same "verify after deploy" caveat as the
 * Stripe and Shipping API integrations.
 */

export type ClickAndDropPostageClass = "first_class" | "second_class";

export interface ClickAndDropOrderInput {
  /** Our own unique reference for this card (echoed on the Click & Drop order,
   * and the natural idempotency key — Click & Drop rejects a duplicate). */
  orderReference: string;
  recipientName: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  postcode: string;
  /** ISO country code; cards are UK ("GB") today. */
  country: string;
  postageClass: ClickAndDropPostageClass;
  /** When the order was placed, ISO 8601. */
  orderDate: string;
  /** The card's charged price in pence, echoed as the order value. */
  subtotalPence: number;
}

export interface ClickAndDropOrderResult {
  /** Royal Mail's identifier for the created Click & Drop order, stored so we
   * never re-push the same card. Stringified (the API returns a number). */
  orderIdentifier: string;
}

export interface ClickAndDropClient {
  /** True when a real, credentialled client is wired (vs the no-op). */
  readonly enabled: boolean;
  createOrder(input: ClickAndDropOrderInput): Promise<ClickAndDropOrderResult>;
}

/**
 * Used when no CLICK_AND_DROP_API_KEY is set: order import is simply off, so no
 * card is pushed to Click & Drop. Any attempt to create an order fails loudly
 * rather than silently pretending — the import service checks `enabled` first.
 */
export class NoopClickAndDropClient implements ClickAndDropClient {
  readonly enabled = false;
  createOrder(): Promise<ClickAndDropOrderResult> {
    return Promise.reject(
      new Error("Click & Drop import is not configured (CLICK_AND_DROP_API_KEY unset)"),
    );
  }
}

/** Optional per-postage-class Click & Drop service codes (from env). When a code
 * is absent the order imports with no service selected, so the operator picks it
 * in the dashboard — safe until the account's exact codes are confirmed. */
export interface ClickAndDropServiceCodes {
  first_class?: string;
  second_class?: string;
}

/** A card in a standard envelope: Large Letter format, ~100g. Matches the
 * Shipping API client's weight band. */
const CARD_WEIGHT_GRAMS = 100;
const PACKAGE_FORMAT = "largeLetter";

/**
 * Real Click & Drop Orders API client. Posts a single order per call to
 * `/api/v1/orders`. The auth key is passed in the Authorization header exactly
 * as the Click & Drop "Edit integration" screen instructs.
 */
export class HttpClickAndDropClient implements ClickAndDropClient {
  readonly enabled = true;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly serviceCodes: ClickAndDropServiceCodes = {},
  ) {}

  async createOrder(input: ClickAndDropOrderInput): Promise<ClickAndDropOrderResult> {
    const serviceCode = this.serviceCodes[input.postageClass];
    const subtotal = Math.max(0, input.subtotalPence) / 100;
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            orderReference: input.orderReference,
            recipient: {
              address: {
                fullName: input.recipientName,
                addressLine1: input.addressLine1,
                ...(input.addressLine2 ? { addressLine2: input.addressLine2 } : {}),
                city: input.city,
                postcode: input.postcode,
                countryCode: input.country,
              },
            },
            packages: [
              { weightInGrams: CARD_WEIGHT_GRAMS, packageFormatIdentifier: PACKAGE_FORMAT },
            ],
            orderDate: input.orderDate,
            subtotal,
            total: subtotal,
            currencyCode: "GBP",
            ...(serviceCode ? { postageDetails: { serviceCode } } : {}),
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Click & Drop order import failed (${response.status}): ${detail.slice(0, 500)}`,
      );
    }

    const data = (await response.json()) as {
      createdOrders?: { orderIdentifier?: number | string; orderReference?: string }[];
      failedOrders?: { errors?: { code?: string; message?: string }[] }[];
    };

    const failure = data.failedOrders?.[0];
    if (failure) {
      const message = failure.errors?.map((e) => e.message).filter(Boolean).join("; ");
      throw new Error(`Click & Drop rejected the order: ${message || "unknown error"}`);
    }

    const created = data.createdOrders?.[0];
    if (created?.orderIdentifier === undefined || created.orderIdentifier === null) {
      throw new Error("Click & Drop order response had no order identifier");
    }
    return { orderIdentifier: String(created.orderIdentifier) };
  }
}
