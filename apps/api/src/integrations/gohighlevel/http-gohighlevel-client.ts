import { BadGatewayException, UnauthorizedException } from "@nestjs/common";
import { httpRequest } from "../../common/http-request";
import type { CrmContactsResult } from "../crm-contacts-result";
import { upstreamDetail, withUpstreamDetail } from "../upstream-detail";
import type { OAuthTokens } from "../oauth-crm-client";
import type { GoHighLevelClient, GoHighLevelContact } from "./gohighlevel-client";

const GOHIGHLEVEL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const GOHIGHLEVEL_CONTACTS_URL = "https://services.leadconnectorhq.com/contacts/";
/** GoHighLevel API v2 requires this date-stamped version header on every call. */
const GOHIGHLEVEL_API_VERSION = "2021-07-28";
export const GOHIGHLEVEL_PAGE_SIZE = 100;
/** Safety bound so a huge location can't hold the nightly sync open forever. It
 * is a real limit, not a formality — a location past it imports partially, and
 * `truncated` on the result is what makes that visible. */
export const GOHIGHLEVEL_MAX_PAGES = 100;
/** Contact pages are reads: safe to repeat, and a single rate-limited page is
 * not a reason to abandon a whole location's import. */
const CONTACTS_ATTEMPTS = 4;

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
    // Deliberately no retry: an authorization code is single-use and a refresh
    // rotates the stored token, so repeating a request the upstream may already
    // have processed can burn the credential we are trying to obtain.
    const response = await httpRequest(
      GOHIGHLEVEL_TOKEN_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams(params).toString(),
      },
      { label: "GoHighLevel token" },
    );

    if (!response.ok) {
      // The secrets go in redacted: our own request carried them, and an upstream
      // that quotes the request back would otherwise put them in a stored status
      // the customer can read.
      const detail = await upstreamDetail(response, {
        secrets: [params.client_secret, params.refresh_token, params.code],
      });
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new UnauthorizedException(
          withUpstreamDetail("GoHighLevel rejected the authorization", detail),
        );
      }
      throw new BadGatewayException(
        withUpstreamDetail(`GoHighLevel token request failed (${response.status})`, detail),
      );
    }

    const body = (await response.json()) as GoHighLevelTokenResponse;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresInSeconds: body.expires_in,
      externalAccountId: body.locationId,
    };
  }

  async fetchContacts(
    accessToken: string,
    locationId: string,
  ): Promise<CrmContactsResult<GoHighLevelContact>> {
    const contacts: GoHighLevelContact[] = [];
    const first = new URLSearchParams({ locationId, limit: String(GOHIGHLEVEL_PAGE_SIZE) });
    let nextUrl: string | null = `${GOHIGHLEVEL_CONTACTS_URL}?${first.toString()}`;

    for (let page = 0; page < GOHIGHLEVEL_MAX_PAGES && nextUrl; page += 1) {
      const response: Response = await httpRequest(
        nextUrl,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
            Version: GOHIGHLEVEL_API_VERSION,
            accept: "application/json",
          },
        },
        { maxAttempts: CONTACTS_ATTEMPTS, label: "GoHighLevel contacts" },
      );

      if (!response.ok) {
        const detail = await upstreamDetail(response, { secrets: [accessToken] });
        if (response.status === 401) {
          throw new UnauthorizedException(
            withUpstreamDetail("GoHighLevel rejected the access token", detail),
          );
        }
        throw new BadGatewayException(
          withUpstreamDetail(`GoHighLevel contacts request failed (${response.status})`, detail),
        );
      }

      const body = (await response.json()) as GoHighLevelContactsPage;
      const batch = body.contacts ?? [];
      contacts.push(...batch);
      // GoHighLevel returns the fully-formed URL for the next page (with its
      // cursor) when there is one; a null/absent value means we're done. An
      // empty page is its real end-of-list, cursor or not.
      nextUrl = batch.length > 0 ? (body.meta?.nextPageUrl ?? null) : null;
    }
    // A cursor still outstanding means the cap, not the location, ended the run.
    return { contacts, truncated: nextUrl !== null };
  }
}
