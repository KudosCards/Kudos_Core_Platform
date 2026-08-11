import { BadGatewayException, UnauthorizedException } from "@nestjs/common";
import type { OAuthTokens } from "../oauth-crm-client";
import type { GoHighLevelClient, GoHighLevelContact } from "./gohighlevel-client";

const GOHIGHLEVEL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const GOHIGHLEVEL_CONTACTS_URL = "https://services.leadconnectorhq.com/contacts/";
/** GoHighLevel API v2 requires this date-stamped version header on every call. */
const GOHIGHLEVEL_API_VERSION = "2021-07-28";
const PAGE_SIZE = 100;
/** Safety bound so a huge location can't spin forever — the plan recipient cap
 * limits what we actually keep anyway. */
const MAX_PAGES = 100;

interface GoHighLevelTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  /** The sub-account the token is scoped to (present on a Location-type grant). */
  locationId?: string;
}

interface GoHighLevelContactsPage {
  contacts?: GoHighLevelContact[];
  meta?: { nextPageUrl?: string | null };
}

/**
 * The real GoHighLevel OAuth + contacts client. Never instantiated in tests
 * (GOHIGHLEVEL_CLIENT is overridden with a mock) — see the provider. `user_type:
 * "Location"` on the token request asks for a location-scoped token (vs an agency
 * one), which is what a per-account contact import needs.
 */
export class HttpGoHighLevelClient implements GoHighLevelClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {}

  exchangeCode(code: string): Promise<OAuthTokens> {
    return this.requestTokens({
      grant_type: "authorization_code",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      user_type: "Location",
      code,
    });
  }

  refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    return this.requestTokens({
      grant_type: "refresh_token",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      user_type: "Location",
      refresh_token: refreshToken,
    });
  }

  private async requestTokens(params: Record<string, string>): Promise<OAuthTokens> {
    const response = await fetch(GOHIGHLEVEL_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    });

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new UnauthorizedException("GoHighLevel rejected the authorization");
    }
    if (!response.ok) {
      throw new BadGatewayException(`GoHighLevel token request failed (${response.status})`);
    }

    const body = (await response.json()) as GoHighLevelTokenResponse;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresInSeconds: body.expires_in,
      externalAccountId: body.locationId,
    };
  }

  async fetchContacts(accessToken: string, locationId: string): Promise<GoHighLevelContact[]> {
    const all: GoHighLevelContact[] = [];
    const first = new URLSearchParams({ locationId, limit: String(PAGE_SIZE) });
    let nextUrl: string | null = `${GOHIGHLEVEL_CONTACTS_URL}?${first.toString()}`;

    for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
      const response: Response = await fetch(nextUrl, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          Version: GOHIGHLEVEL_API_VERSION,
          accept: "application/json",
        },
      });

      if (response.status === 401) {
        throw new UnauthorizedException("GoHighLevel rejected the access token");
      }
      if (!response.ok) {
        throw new BadGatewayException(`GoHighLevel contacts request failed (${response.status})`);
      }

      const body = (await response.json()) as GoHighLevelContactsPage;
      const batch = body.contacts ?? [];
      all.push(...batch);
      // GoHighLevel returns the fully-formed URL for the next page (with its
      // cursor) when there is one; a null/absent value means we're done.
      nextUrl = batch.length > 0 ? (body.meta?.nextPageUrl ?? null) : null;
    }
    return all;
  }
}
