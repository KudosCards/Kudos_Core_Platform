/**
 * HubSpot contacts source, behind an interface + injectable token so the real
 * HTTP implementation can be swapped for a mock in tests — the same pattern as
 * BREVO_CLIENT / CATALOG_SOURCE, since this build/test environment has no
 * network path to HubSpot. See docs/adr/0015-crm-integrations.md (Phase 3).
 */
export const HUBSPOT_CLIENT = Symbol("HUBSPOT_CLIENT");

/** HubSpot's OAuth authorization endpoint (where the user grants access). */
export const HUBSPOT_AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";

/**
 * The scopes we request: read-only access to CRM contacts. `oauth` is implied
 * by the flow. We deliberately ask for nothing we don't use — one-way import
 * only, no write-back (see the ADR).
 */
export const HUBSPOT_SCOPES = ["crm.objects.contacts.read"] as const;

/** Tokens returned by an OAuth code-exchange or refresh. */
export interface HubSpotTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires (HubSpot returns ~1800). */
  expiresInSeconds: number;
}

/** A HubSpot contact, trimmed to what we read. `properties` is HubSpot's bag of
 * standard (firstname, lastname, email, …) and custom fields. */
export interface HubSpotContact {
  id: string;
  properties: Record<string, unknown>;
}

export interface HubSpotClient {
  /** Exchanges an OAuth authorization code for tokens (connect step). */
  exchangeCode(code: string): Promise<HubSpotTokens>;
  /** Trades a refresh token for a fresh access token (long-lived refresh). */
  refreshTokens(refreshToken: string): Promise<HubSpotTokens>;
  /** Fetches every contact the token can see, requesting the given property
   * names (HubSpot only returns properties you ask for beyond a small default
   * set). Paginated internally. */
  fetchContacts(accessToken: string, properties: string[]): Promise<HubSpotContact[]>;
}
