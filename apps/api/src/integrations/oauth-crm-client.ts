/**
 * The token half of an OAuth CRM client, shared across providers (HubSpot,
 * GoHighLevel, …) so CrmConnectionsService can exchange/refresh generically. The
 * *contacts* half stays provider-specific (each CRM's contacts API differs — e.g.
 * HubSpot takes a property list, GoHighLevel takes a locationId), so it isn't part
 * of this interface. See docs/adr/0015-crm-integrations.md.
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires (provider-reported). */
  expiresInSeconds: number;
  /** The provider account id to persist against the connection — GoHighLevel's
   * locationId (the sub-account the token is scoped to). HubSpot omits it. */
  externalAccountId?: string;
}

export interface OAuthCrmClient {
  /** Exchanges an OAuth authorization code for tokens (connect step). */
  exchangeCode(code: string): Promise<OAuthTokens>;
  /** Trades a refresh token for a fresh access token. */
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
}
