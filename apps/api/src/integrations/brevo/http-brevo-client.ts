import { BadGatewayException, UnauthorizedException } from "@nestjs/common";
import type { BrevoClient, BrevoContact } from "./brevo-client";

const BREVO_BASE_URL = "https://api.brevo.com/v3";
const PAGE_SIZE = 500;
/** Safety bound so a huge Brevo list can't spin forever — the plan recipient
 * cap limits what we actually keep anyway. */
const MAX_PAGES = 20;

interface BrevoContactsResponse {
  contacts: BrevoContact[];
  count: number;
}

/** The real Brevo REST client. Never instantiated in tests (BREVO_CLIENT is
 * overridden with a mock) — see the provider. */
export class HttpBrevoClient implements BrevoClient {
  async verifyKey(apiKey: string): Promise<void> {
    const response = await fetch(`${BREVO_BASE_URL}/contacts?limit=1`, {
      headers: { "api-key": apiKey, accept: "application/json" },
    });
    if (response.status === 401) {
      throw new UnauthorizedException("Brevo rejected the API key");
    }
    if (!response.ok) {
      throw new BadGatewayException(`Brevo request failed (${response.status})`);
    }
  }

  async fetchContacts(apiKey: string): Promise<BrevoContact[]> {
    const all: BrevoContact[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = `${BREVO_BASE_URL}/contacts?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
      const response = await fetch(url, {
        headers: { "api-key": apiKey, accept: "application/json" },
      });

      if (response.status === 401) {
        throw new UnauthorizedException("Brevo rejected the API key");
      }
      if (!response.ok) {
        throw new BadGatewayException(`Brevo request failed (${response.status})`);
      }

      const body = (await response.json()) as BrevoContactsResponse;
      const contacts = body.contacts ?? [];
      all.push(...contacts);
      if (contacts.length < PAGE_SIZE || all.length >= body.count) {
        break;
      }
    }
    return all;
  }
}
