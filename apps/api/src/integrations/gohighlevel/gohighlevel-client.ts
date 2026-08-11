import type { OAuthTokens } from "../oauth-crm-client";

/**
 * GoHighLevel (HighLevel) contacts source, behind an interface + injectable token
 * so the real HTTP implementation is swapped for a mock in tests — the same
 * pattern as HUBSPOT_CLIENT / BREVO_CLIENT, since this build/test environment has
 * no network path to GoHighLevel. See docs/adr/0015-crm-integrations.md.
 */
export const GOHIGHLEVEL_CLIENT = Symbol("GOHIGHLEVEL_CLIENT");

/**
 * GoHighLevel's OAuth "choose a location" consent screen. Unlike a plain
 * authorize endpoint, this lets the user pick which sub-account (location) to
 * grant us — the token that comes back is scoped to that location, whose id we
 * persist and must pass on every contacts call.
 */
export const GOHIGHLEVEL_AUTHORIZE_URL =
  "https://marketplace.gohighlevel.com/v2/oauth/chooselocation";

/**
 * The scopes we request. `contacts.readonly` is read-only contact access — we ask
 * for nothing we don't use (one-way import only, no write-back; see the ADR). Must
 * match the Marketplace app's configured scopes exactly or GoHighLevel rejects the
 * install.
 */
export const GOHIGHLEVEL_SCOPES = ["contacts.readonly"] as const;

/** A GoHighLevel contact. Their API returns a flat object of standard fields
 * (firstName, lastName, email, dateOfBirth, address1, …); we read by name via the
 * mapping, so the shape is deliberately open beyond the always-present id. */
export type GoHighLevelContact = { id: string } & Record<string, unknown>;

export interface GoHighLevelClient {
  /** Exchanges an OAuth authorization code for tokens; `externalAccountId` on the
   * result is the granted locationId. */
  exchangeCode(code: string): Promise<OAuthTokens>;
  /** Trades a refresh token for a fresh access token. */
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
  /** Fetches every contact in the given location the token can see. Paginated
   * internally. The locationId is required — GoHighLevel scopes contacts to it. */
  fetchContacts(accessToken: string, locationId: string): Promise<GoHighLevelContact[]>;
}
