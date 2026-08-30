import { BadGatewayException, UnauthorizedException } from "@nestjs/common";
import { httpRequest } from "../../common/http-request";
import type { CrmContactsResult } from "../crm-contacts-result";
import type { HubSpotClient, HubSpotContact, HubSpotTokens } from "./hubspot-client";

const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const HUBSPOT_CONTACTS_URL = "https://api.hubapi.com/crm/v3/objects/contacts";
/** HubSpot's max page size for CRM objects. */
export const HUBSPOT_PAGE_SIZE = 100;
/** Safety bound so a huge portal can't hold the nightly sync open forever. It is
 * a real limit, not a formality — a portal past it imports partially, and
 * `truncated` on the result is what makes that visible. */
export const HUBSPOT_MAX_PAGES = 50;
/** Contact pages are reads: safe to repeat, and a single rate-limited page is
 * not a reason to abandon a whole portal's import. */
const CONTACTS_ATTEMPTS = 4;

interface HubSpotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface HubSpotContactsPage {
  results: HubSpotContact[];
  paging?: { next?: { after?: string } };
}

/**
 * The real HubSpot OAuth + contacts client. Never instantiated in tests
 * (HUBSPOT_CLIENT is overridden with a mock) — see the provider. The OAuth
 * client id/secret and redirect URI come from config; the interface stays free
 * of them so mocks don't need them.
 */
export class HttpHubSpotClient implements HubSpotClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {}

  exchangeCode(code: string): Promise<HubSpotTokens> {
    return this.requestTokens({
      grant_type: "authorization_code",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      code,
    });
  }

  refreshTokens(refreshToken: string): Promise<HubSpotTokens> {
    return this.requestTokens({
      grant_type: "refresh_token",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
    });
  }

  private async requestTokens(params: Record<string, string>): Promise<HubSpotTokens> {
    // Deliberately no retry: an authorization code is single-use and HubSpot
    // rotates refresh tokens on use, so repeating a request it may already have
    // processed can burn the credential we are trying to obtain.
    const response = await httpRequest(
      HUBSPOT_TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
      },
      { label: "HubSpot token" },
    );

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      // HubSpot returns 400 for an invalid/expired code or refresh token.
      throw new UnauthorizedException("HubSpot rejected the authorization");
    }
    if (!response.ok) {
      throw new BadGatewayException(`HubSpot token request failed (${response.status})`);
    }

    const body = (await response.json()) as HubSpotTokenResponse;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresInSeconds: body.expires_in,
    };
  }

  async fetchContacts(
    accessToken: string,
    properties: string[],
  ): Promise<CrmContactsResult<HubSpotContact>> {
    const contacts: HubSpotContact[] = [];
    let after: string | undefined;

    for (let page = 0; page < HUBSPOT_MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ limit: String(HUBSPOT_PAGE_SIZE) });
      for (const property of properties) {
        query.append("properties", property);
      }
      if (after) {
        query.set("after", after);
      }

      const response = await httpRequest(
        `${HUBSPOT_CONTACTS_URL}?${query.toString()}`,
        { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } },
        { maxAttempts: CONTACTS_ATTEMPTS, label: "HubSpot contacts" },
      );

      if (response.status === 401) {
        throw new UnauthorizedException("HubSpot rejected the access token");
      }
      if (!response.ok) {
        throw new BadGatewayException(`HubSpot contacts request failed (${response.status})`);
      }

      const body = (await response.json()) as HubSpotContactsPage;
      contacts.push(...(body.results ?? []));
      after = body.paging?.next?.after;
      if (!after) {
        return { contacts, truncated: false };
      }
    }
    // The cap ran out while HubSpot was still offering another cursor.
    return { contacts, truncated: true };
  }
}
