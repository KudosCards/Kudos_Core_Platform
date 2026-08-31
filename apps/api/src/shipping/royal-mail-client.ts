/**
 * Royal Mail Shipping API v4 (Click & Drop / Intersoft) client — creates a
 * shipment, buys the postage, and returns a tracking number (and, where
 * available, a label URL). We deliberately depend on a small interface, not the
 * raw wire format, so the fulfillment flow is testable with a mock and a real
 * provider can be swapped/verified independently. See
 * docs/adr/0072-royal-mail-shipping.md.
 */

export type RoyalMailPostageClass = "first_class" | "second_class";

import { httpRequest } from "../common/http-request";

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

/**
 * A carrier delivery state, normalised from Royal Mail's tracking events to the
 * three outcomes our fulfillment state machine cares about. Anything we don't
 * recognise as delivered stays `in_transit` (keep polling); `unknown` means the
 * tracking number wasn't found or the response couldn't be read (also keep
 * polling — a transient lookup miss must never be read as "delivered").
 */
export type RoyalMailDeliveryStatus = "delivered" | "in_transit" | "unknown";

export interface TrackingStatusResult {
  /** The normalised delivery state — only `delivered` advances the job. */
  status: RoyalMailDeliveryStatus;
  /** When Royal Mail recorded delivery, if delivered and a timestamp was
   * returned; null otherwise (the poller then stamps its own observation time). */
  deliveredAt: Date | null;
  /** The raw carrier status text, kept for logging/diagnosis. */
  rawStatus: string | null;
}

export interface RoyalMailClient {
  /** True when a real, credentialled client is wired (vs the no-op). */
  readonly enabled: boolean;
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  /**
   * Read the current delivery state for a tracking number. Read-only — used by
   * the delivery poll to auto-register `posted → delivered`. Must never throw
   * for a simple "not delivered yet"; only a real transport/HTTP error throws.
   */
  getTrackingStatus(trackingNumber: string): Promise<TrackingStatusResult>;
}

// The customer-facing Royal Mail tracking URL now lives in @kudos/shared-types
// (one source of truth, shared with the buyer's order page). Re-exported here so
// existing shipping-module callers keep their import path.
export { royalMailTrackingUrl } from "@kudos/shared-types";

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
  getTrackingStatus(): Promise<TrackingStatusResult> {
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

/** A card in a standard envelope: Letter weight band, in grams. */
const CARD_WEIGHT_GRAMS = 100;
/** Tracking is a read, polled on a sweep: retrying a rate-limited or briefly
 * broken response beats losing that card's update until the next sweep. */
const TRACKING_ATTEMPTS = 3;

/**
 * Map a raw Royal Mail tracking status string to our normalised delivery state.
 * RM's tracking summaries phrase delivery a few ways ("Delivered", "Item
 * delivered", "Delivered to …", a "DELIVERED" status code); we match the
 * past-tense word "delivered" case-insensitively. Deliberately NOT "deliver",
 * so pre-delivery states that share the stem — "Out for delivery", "Ready for
 * delivery", "Attempted delivery" — stay `in_transit` and don't prematurely
 * close a card. Kept a pure function so it's unit-testable and shared by
 * whatever tracking response shape the account returns. Empty/absent is
 * `unknown`.
 */
export function normaliseTrackingStatus(
  rawStatus: string | null | undefined,
): RoyalMailDeliveryStatus {
  if (!rawStatus) return "unknown";
  return /delivered/i.test(rawStatus) ? "delivered" : "in_transit";
}

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
    // Deliberately no retry: Royal Mail may have booked the shipment and failed
    // to answer, and a second attempt would book a second one — a second card in
    // the post, at our cost. A failed booking is surfaced instead.
    const response = await httpRequest(
      `${this.baseUrl.replace(/\/$/, "")}/api/v4/shipments`,
      {
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
          packages: [{ weightInGrams: CARD_WEIGHT_GRAMS, packageType: "letter" }],
        }),
      },
      { label: "Royal Mail shipment" },
    );

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

  /**
   * Read a tracking number's current state. The request/response shape follows
   * Royal Mail's documented tracking resource, but the exact path and field
   * names are account-specific and MUST be verified against the sandbox before
   * go-live — the same caveat as createShipment. Read-only, so it never throws
   * for "not delivered yet": a 404 (tracking not yet visible) returns `unknown`
   * and the poll simply tries again next sweep; only a real transport error or a
   * non-404 HTTP failure throws, so the operator sees it.
   */
  async getTrackingStatus(trackingNumber: string): Promise<TrackingStatusResult> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/v4/shipments/${encodeURIComponent(
      trackingNumber,
    )}/tracking`;
    const response = await httpRequest(
      url,
      { method: "GET", headers: { Authorization: this.apiKey, Accept: "application/json" } },
      { maxAttempts: TRACKING_ATTEMPTS, label: "Royal Mail tracking" },
    );

    // Not-yet-tracked is a normal, transient state — not an error to surface.
    if (response.status === 404) {
      return { status: "unknown", deliveredAt: null, rawStatus: null };
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Royal Mail tracking failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    // Accept the common shapes: a top-level summary, or the latest of an events
    // array. We only need the status text and (when delivered) a timestamp.
    const data = (await response.json().catch(() => ({}))) as {
      status?: string;
      statusDescription?: string;
      deliveredOn?: string;
      deliveredAt?: string;
      summary?: { status?: string; statusDescription?: string; lastEventDateTime?: string };
      events?: { status?: string; description?: string; dateTime?: string }[];
    };

    const latestEvent = data.events?.[data.events.length - 1];
    const rawStatus =
      data.summary?.statusDescription ??
      data.summary?.status ??
      data.statusDescription ??
      data.status ??
      latestEvent?.description ??
      latestEvent?.status ??
      null;

    const status = normaliseTrackingStatus(rawStatus);
    const deliveredAtRaw =
      status === "delivered"
        ? (data.deliveredOn ??
          data.deliveredAt ??
          data.summary?.lastEventDateTime ??
          latestEvent?.dateTime ??
          null)
        : null;
    const parsed = deliveredAtRaw ? new Date(deliveredAtRaw) : null;
    const deliveredAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;

    return { status, deliveredAt, rawStatus };
  }
}
