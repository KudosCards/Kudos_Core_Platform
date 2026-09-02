import { BadGatewayException, UnauthorizedException } from "@nestjs/common";
import { httpRequest } from "../../common/http-request";
import { startFetchBudget } from "../fetch-budget";
import type { CrmContactsResult } from "../crm-contacts-result";
import { upstreamDetail, withUpstreamDetail } from "../upstream-detail";
import type { BrevoClient, BrevoContact } from "./brevo-client";

const BREVO_BASE_URL = "https://api.brevo.com/v3";
export const BREVO_PAGE_SIZE = 500;
/** Safety bound so a huge Brevo list can't hold the nightly sync open forever.
 * It is a real limit, not a formality — a list past it imports partially, and
 * `truncated` on the result is what makes that visible. */
export const BREVO_MAX_PAGES = 20;
/** Contact pages are reads: safe to repeat, and a single rate-limited page is
 * not a reason to abandon a whole list's import. */
const CONTACTS_ATTEMPTS = 4;

interface BrevoContactsResponse {
  contacts: BrevoContact[];
  count: number;
}

/** The real Brevo REST client. Never instantiated in tests (BREVO_CLIENT is
 * overridden with a mock) — see the provider. */
export class HttpBrevoClient implements BrevoClient {
  async verifyKey(apiKey: string): Promise<void> {
    const response = await httpRequest(
      `${BREVO_BASE_URL}/contacts?limit=1`,
      { headers: { "api-key": apiKey, accept: "application/json" } },
      { maxAttempts: CONTACTS_ATTEMPTS, label: "Brevo key check" },
    );
    if (!response.ok) {
      const detail = await upstreamDetail(response, { secrets: [apiKey] });
      if (response.status === 401) {
        throw new UnauthorizedException(withUpstreamDetail("Brevo rejected the API key", detail));
      }
      throw new BadGatewayException(
        withUpstreamDetail(`Brevo request failed (${response.status})`, detail),
      );
    }
  }

  async fetchContacts(apiKey: string): Promise<CrmContactsResult<BrevoContact>> {
    const contacts: BrevoContact[] = [];
    // Bounds the whole pull, not each request — see fetch-budget.ts.
    const budget = startFetchBudget();
    for (let page = 0; page < BREVO_MAX_PAGES && !budget.expired(); page += 1) {
      const offset = page * BREVO_PAGE_SIZE;
      const response = await httpRequest(
        `${BREVO_BASE_URL}/contacts?limit=${BREVO_PAGE_SIZE}&offset=${offset}`,
        { headers: { "api-key": apiKey, accept: "application/json" } },
        { maxAttempts: CONTACTS_ATTEMPTS, label: "Brevo contacts" },
      );

      if (!response.ok) {
        const detail = await upstreamDetail(response, { secrets: [apiKey] });
        if (response.status === 401) {
          throw new UnauthorizedException(withUpstreamDetail("Brevo rejected the API key", detail));
        }
        throw new BadGatewayException(
          withUpstreamDetail(`Brevo request failed (${response.status})`, detail),
        );
      }

      const body = (await response.json()) as BrevoContactsResponse;
      const batch = body.contacts ?? [];
      contacts.push(...batch);
      // A short page, or having everything Brevo says exists, is the real end
      // of the list — reaching either means nothing was left behind.
      if (batch.length < BREVO_PAGE_SIZE || contacts.length >= body.count) {
        return { contacts, truncated: false };
      }
    }
    // The cap ran out with Brevo still reporting more contacts than we hold.
    return { contacts, truncated: true };
  }
}
