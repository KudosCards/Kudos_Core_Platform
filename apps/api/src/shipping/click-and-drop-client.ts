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

/** How the API key is presented in the Authorization header. Royal Mail's own
 * cURL example uses the raw key with no scheme; some SDK docs prefix "Bearer".
 * Configurable so the scheme can be flipped without a code change if an account
 * needs the other form. See docs/adr/0095-click-and-drop-import.md. */
export type ClickAndDropAuthScheme = "raw" | "bearer";

/** The result of a live connectivity/auth probe — a real HTTP round-trip to the
 * Click & Drop API that reads (never writes), so an operator can validate a key
 * and see the exact status + body rather than waiting for the sweep to fail. */
export interface ClickAndDropProbeResult {
  /** Whether the probe request itself succeeded (HTTP 2xx). */
  ok: boolean;
  /** The HTTP status returned (0 if the request never completed / not configured). */
  status: number;
  /** The raw response body, truncated — a 401 body pinpoints an auth problem. */
  body: string;
  /** The exact URL hit (reveals the configured base URL). */
  endpoint: string;
  /** The Authorization scheme used for the probe. */
  authScheme: ClickAndDropAuthScheme;
  /** Set when the request threw before a response (DNS/TLS/network). */
  error?: string;
}

/**
 * The outcome of asking Click & Drop to delete some orders. Partial success is
 * the normal case, not an edge case — Royal Mail rejects a delete once the order
 * has been despatched — so this reports per-identifier rather than throwing.
 * Every identifier passed in comes back in exactly one of the two lists.
 */
export interface ClickAndDropCancelResult {
  /** Identifiers Royal Mail confirmed are gone from the dashboard queue. */
  cancelled: string[];
  /** Identifiers still sitting in Click & Drop, each with Royal Mail's reason. */
  failed: { orderIdentifier: string; reason: string }[];
}

export interface ClickAndDropClient {
  /** True when a real, credentialled client is wired (vs the no-op). */
  readonly enabled: boolean;
  createOrder(input: ClickAndDropOrderInput): Promise<ClickAndDropOrderResult>;
  /**
   * Delete orders from the Click & Drop dashboard queue — the undo for
   * `createOrder`, used when a card is refunded before it is posted. Without it
   * a refunded card stays in the operator's queue and Royal Mail prints and
   * posts it anyway, with the customer's money already returned. Never throws:
   * a rejection for one identifier is reported in `failed`, not raised, so one
   * un-deletable card can't strand the rest. See ADR 0179.
   */
  cancelOrders(orderIdentifiers: string[]): Promise<ClickAndDropCancelResult>;
  /** A live read-only call to validate connectivity + auth (never creates an order). */
  probe(): Promise<ClickAndDropProbeResult>;
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
  /** Nothing was ever imported, so nothing needs deleting. Unlike createOrder
   * this resolves rather than rejects: a refund must not fail because order
   * import happens to be switched off. */
  cancelOrders(): Promise<ClickAndDropCancelResult> {
    return Promise.resolve({ cancelled: [], failed: [] });
  }
  probe(): Promise<ClickAndDropProbeResult> {
    return Promise.resolve({
      ok: false,
      status: 0,
      body: "Click & Drop import is not configured (CLICK_AND_DROP_API_KEY unset)",
      endpoint: "",
      authScheme: "raw",
    });
  }
}

/** Optional per-postage-class Click & Drop service codes (from env). When a code
 * is absent the order imports with no service selected, so the operator picks it
 * in the dashboard — safe until the account's exact codes are confirmed. */
export interface ClickAndDropServiceCodes {
  first_class?: string;
  second_class?: string;
}

/** A card in a standard envelope: Letter format, ~100g. Matches the Shipping
 * API client's weight band. Letter (not Large Letter) is the cheaper Royal Mail
 * format our A6 cards qualify for — see docs/adr/0160-letter-format-cutoff-birthday-qr.md. */
const CARD_WEIGHT_GRAMS = 100;
const PACKAGE_FORMAT = "letter";

/**
 * A rejected line in a Click & Drop `failedOrders` response. Royal Mail's field
 * naming is inconsistent across accounts/versions — some responses use
 * `errorCode`/`errorMessage`, others `code`/`message`, and the error may sit at
 * the top level or nested under `errors[]`. We accept them all (loosely typed on
 * purpose) so `describeFailedOrder` can find *some* human-readable reason rather
 * than collapsing to "unknown error". See docs/adr/0095-click-and-drop-import.md.
 */
export interface ClickAndDropFailedOrderError {
  errorCode?: string | number;
  errorMessage?: string;
  code?: string | number;
  message?: string;
  fields?: string[];
}

export interface ClickAndDropFailedOrder extends ClickAndDropFailedOrderError {
  orderReference?: string;
  errors?: ClickAndDropFailedOrderError[];
}

/** The first non-empty of a set of candidate strings, trimmed. */
function firstNonEmpty(...candidates: (string | number | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const text = String(candidate).trim();
    if (text) return text;
  }
  return undefined;
}

/** The envelope of a Click & Drop create response — the top-level object, which
 * may itself carry the error fields when `failedOrders[]` doesn't. */
export interface ClickAndDropCreateResponse extends ClickAndDropFailedOrderError {
  createdOrders?: { orderIdentifier?: number | string; orderReference?: string }[];
  failedOrders?: ClickAndDropFailedOrder[];
}

/**
 * Turn a Click & Drop rejection into the most useful message we can. Looks for a
 * human-readable `errorMessage`/`message` (and code) in the failed line, its
 * nested `errors[]`, *and* the top-level envelope — Royal Mail puts the reason in
 * different places across accounts/versions. Failing all of that it returns the
 * raw response body verbatim, so the operator always sees exactly what Royal Mail
 * sent, never a bare "unknown error" — even when `failedOrders[0]` is an empty
 * object (which is how we first hit this).
 */
export function describeFailedOrder(
  failure: ClickAndDropFailedOrder | undefined,
  envelope: ClickAndDropFailedOrderError = {},
  rawBody = "",
): string {
  const nested = failure?.errors?.[0];
  const message = firstNonEmpty(
    failure?.errorMessage,
    failure?.message,
    nested?.errorMessage,
    nested?.message,
    envelope.errorMessage,
    envelope.message,
  );
  const code = firstNonEmpty(
    failure?.errorCode,
    failure?.code,
    nested?.errorCode,
    nested?.code,
    envelope.errorCode,
    envelope.code,
  );

  if (message) {
    return code ? `${message} (${code})` : message;
  }
  if (code) {
    return `error code ${code}`;
  }
  // No recognised field anywhere — surface the raw response body rather than
  // hide it. This is the branch that turns "unknown error" into a real clue.
  const raw = rawBody.trim() || JSON.stringify(failure ?? {});
  return raw && raw !== "{}" ? raw.slice(0, 400) : "unknown error";
}

/** How many order identifiers go into one DELETE. They travel as a
 * comma-separated URL path segment, so the request line has to stay a sane
 * length however many cards a refunded order had. */
const CANCEL_BATCH_SIZE = 50;

/** The envelope of a Click & Drop delete response. Royal Mail documents
 * `deletedOrders` (identifiers) and `errors` (per-identifier reasons); as with
 * the create response the exact naming varies by account/version, so this is
 * loose on purpose and anything unrecognised falls through to "not confirmed
 * deleted". */
export interface ClickAndDropDeleteResponse {
  deletedOrders?: (number | string)[];
  errors?: {
    orderIdentifier?: number | string;
    code?: string | number;
    message?: string;
    errorCode?: string | number;
    errorMessage?: string;
  }[];
}

/**
 * Split a delete response into confirmed-gone and still-there, always covering
 * every identifier that was asked for.
 *
 * The default is *failure*: an identifier is only reported cancelled when the
 * response names it in `deletedOrders`. An unreadable body, a shape we don't
 * recognise, or a silently-dropped identifier therefore surfaces as a card an
 * operator must check — never as a card quietly assumed to be pulled.
 */
export function parseCancelResponse(
  rawBody: string,
  requested: string[],
): ClickAndDropCancelResult {
  let data: ClickAndDropDeleteResponse = {};
  try {
    data = (rawBody ? JSON.parse(rawBody) : {}) as ClickAndDropDeleteResponse;
  } catch {
    const reason = `Click & Drop returned an unreadable delete response: ${rawBody.slice(0, 300) || "(empty body)"}`;
    return {
      cancelled: [],
      failed: requested.map((orderIdentifier) => ({ orderIdentifier, reason })),
    };
  }

  const deleted = new Set((data.deletedOrders ?? []).map((id) => String(id)));
  const reasonById = new Map<string, string>();
  for (const error of data.errors ?? []) {
    if (error.orderIdentifier === undefined || error.orderIdentifier === null) continue;
    const message = firstNonEmpty(error.errorMessage, error.message);
    const code = firstNonEmpty(error.errorCode, error.code);
    const reason = message
      ? code
        ? `${message} (${code})`
        : message
      : code
        ? `error code ${code}`
        : "Click & Drop rejected the delete without giving a reason";
    reasonById.set(String(error.orderIdentifier), reason);
  }

  const cancelled: string[] = [];
  const failed: { orderIdentifier: string; reason: string }[] = [];
  for (const orderIdentifier of requested) {
    if (deleted.has(orderIdentifier)) {
      cancelled.push(orderIdentifier);
    } else {
      failed.push({
        orderIdentifier,
        reason:
          reasonById.get(orderIdentifier) ?? "Click & Drop did not confirm this order was deleted",
      });
    }
  }
  return { cancelled, failed };
}

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
    private readonly authScheme: ClickAndDropAuthScheme = "raw",
  ) {}

  private ordersUrl(): string {
    return `${this.baseUrl.replace(/\/$/, "")}/api/v1/orders`;
  }

  /** The Authorization header value — the raw key, or "Bearer <key>" when the
   * account needs the scheme prefix (see CLICK_AND_DROP_AUTH_SCHEME). */
  private authHeader(): string {
    return this.authScheme === "bearer" ? `Bearer ${this.apiKey}` : this.apiKey;
  }

  /**
   * A read-only GET to the orders resource: validates the base URL, network path
   * and API key without creating anything. A 401/403 body pinpoints an auth key
   * problem; a 2xx confirms the credential works. Never throws — surfaces the
   * status + body for the operator to read.
   */
  async probe(): Promise<ClickAndDropProbeResult> {
    const endpoint = this.ordersUrl();
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { Authorization: this.authHeader(), Accept: "application/json" },
      });
      const body = await response.text().catch(() => "");
      return {
        ok: response.ok,
        status: response.status,
        body: body.slice(0, 1000),
        endpoint,
        authScheme: this.authScheme,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        body: "",
        endpoint,
        authScheme: this.authScheme,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete orders from the Click & Drop queue — `DELETE /api/v1/orders/{ids}`,
   * which takes a comma-separated list and answers with the identifiers it
   * removed plus a per-identifier reason for the ones it wouldn't.
   *
   * Batched at CANCEL_BATCH_SIZE because the path is a URL segment: a refunded
   * 500-card order would otherwise build a URL no proxy would carry.
   *
   * Whatever goes wrong — a rejected identifier, a 500, DNS failure — comes back
   * in `failed` rather than as a throw. The caller has already refunded the
   * customer by the time it gets here, so its job is to tell an operator which
   * cards to pull by hand, and it can only do that if it is handed a list.
   *
   * IMPORTANT: the same "verify against the live API after deploy" caveat as the
   * rest of this file. Any identifier the response does not explicitly confirm
   * deleted is treated as still live, which is the safe direction to be wrong in
   * — it raises an alert about a card that may already be gone, rather than
   * staying quiet about one Royal Mail is about to post.
   */
  async cancelOrders(orderIdentifiers: string[]): Promise<ClickAndDropCancelResult> {
    const cancelled: string[] = [];
    const failed: { orderIdentifier: string; reason: string }[] = [];

    for (let i = 0; i < orderIdentifiers.length; i += CANCEL_BATCH_SIZE) {
      const batch = orderIdentifiers.slice(i, i + CANCEL_BATCH_SIZE);
      const endpoint = `${this.ordersUrl()}/${batch.map(encodeURIComponent).join(",")}`;
      try {
        const response = await fetch(endpoint, {
          method: "DELETE",
          headers: { Authorization: this.authHeader(), Accept: "application/json" },
        });
        const rawBody = await response.text().catch(() => "");
        if (!response.ok) {
          const reason = `Click & Drop delete failed — DELETE ${endpoint} (${response.status}): ${rawBody.slice(0, 300)}`;
          for (const orderIdentifier of batch) failed.push({ orderIdentifier, reason });
          continue;
        }
        const parsed = parseCancelResponse(rawBody, batch);
        cancelled.push(...parsed.cancelled);
        failed.push(...parsed.failed);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        for (const orderIdentifier of batch) failed.push({ orderIdentifier, reason });
      }
    }

    return { cancelled, failed };
  }

  async createOrder(input: ClickAndDropOrderInput): Promise<ClickAndDropOrderResult> {
    const serviceCode = this.serviceCodes[input.postageClass];
    const subtotal = Math.max(0, input.subtotalPence) / 100;
    // Click & Drop requires `shippingCostCharged` on every order line. Our flat
    // card price is postage-inclusive — nothing is billed to the customer as a
    // separate shipping line — so it's 0, and the order total is just the
    // subtotal. (Omitting it made Click & Drop reject the order outright:
    // "Required property 'shippingCostCharged' not found in JSON".)
    const shippingCostCharged = 0;
    const total = subtotal + shippingCostCharged;
    const endpoint = this.ordersUrl();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
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
            shippingCostCharged,
            total,
            currencyCode: "GBP",
            ...(serviceCode ? { postageDetails: { serviceCode } } : {}),
          },
        ],
      }),
    });

    // Read the body once as text and keep it, so the real Click & Drop reason is
    // never lost — whatever shape (or non-shape) it arrives in.
    const rawBody = await response.text().catch(() => "");

    if (!response.ok) {
      throw new Error(
        `Click & Drop order import failed — POST ${endpoint} (${response.status}): ${rawBody.slice(
          0,
          500,
        )}`,
      );
    }

    let data: ClickAndDropCreateResponse;
    try {
      data = (rawBody ? JSON.parse(rawBody) : {}) as ClickAndDropCreateResponse;
    } catch {
      throw new Error(
        `Click & Drop returned an unreadable response: ${rawBody.slice(0, 500) || "(empty body)"}`,
      );
    }

    // Success first: a created order with an identifier is the only good outcome.
    const created = data.createdOrders?.[0];
    if (created?.orderIdentifier !== undefined && created.orderIdentifier !== null) {
      return { orderIdentifier: String(created.orderIdentifier) };
    }

    // Anything else is a rejection — surface the most specific reason we can find,
    // always with the raw response body as the ultimate fallback so an empty or
    // unexpected `failedOrders` shape still yields a real clue, not "unknown error".
    throw new Error(
      `Click & Drop rejected the order: ${describeFailedOrder(data.failedOrders?.[0], data, rawBody)}`,
    );
  }
}
