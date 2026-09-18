import { BadGatewayException, UnauthorizedException } from "@nestjs/common";
import { httpRequest } from "../../common/http-request";
import { startFetchBudget } from "../../common/fetch-budget";
import type { CrmContactsResult } from "../crm-contacts-result";
import { upstreamDetail, withUpstreamDetail } from "../upstream-detail";
import type { CleanCloudClient, CleanCloudCustomer } from "./cleancloud-client";
import { extractCustomers } from "./cleancloud-response";
import { cleanCloudDate, customerWindows, type DateWindow } from "./cleancloud-windows";

export const CLEANCLOUD_BASE_URL = "https://cleancloudapp.com/api";

/**
 * Contact reads are safe to repeat, and one rate-limited window is not a reason
 * to abandon a decade of history. CleanCloud publishes no rate limit we could
 * pace against, so the retry honours whatever `Retry-After` it sends and falls
 * back to exponential backoff — see http-request.ts.
 */
const CUSTOMER_ATTEMPTS = 4;

/**
 * Deactivated customers are people who asked to be removed or were closed off
 * by the operator. Importing them would put a card in the post to someone the
 * business has already stopped serving.
 */
const EXCLUDE_DEACTIVATED = 1;

/** The real CleanCloud client. Never instantiated in tests (CLEANCLOUD_CLIENT
 * is overridden with a mock) — see the provider. */
export class HttpCleanCloudClient implements CleanCloudClient {
  /**
   * A single one-day window, which is the cheapest thing `getCustomer` will
   * answer. Its job is to separate "this token is wrong" from "CleanCloud is
   * down" before we commit to ~118 requests; whether that day contains any
   * customers is beside the point, so an empty result is a pass.
   */
  async verifyKey(apiToken: string): Promise<void> {
    const today = new Date();
    await this.readWindow(apiToken, { from: today, to: today }, "CleanCloud token check");
  }

  async fetchCustomers(
    apiToken: string,
    now: Date = new Date(),
  ): Promise<CrmContactsResult<CleanCloudCustomer>> {
    const plan = customerWindows(now);
    const customers: CleanCloudCustomer[] = [];
    // Bounds the whole pull, not each request — see fetch-budget.ts.
    const budget = startFetchBudget();

    for (const window of plan.windows) {
      if (budget.expired()) {
        // Out of time with this window, and every older one, still unread.
        // Everything held so far is real and worth keeping; `truncated` is how
        // the customer learns the rest of their history did not arrive. See
        // ADR 0231.
        return { contacts: customers, truncated: true };
      }
      customers.push(...(await this.readWindow(apiToken, window, "CleanCloud customers")));
    }

    return { contacts: customers, truncated: !plan.coversFullHistory };
  }

  /** One `getCustomer` call for one date range. */
  private async readWindow(
    apiToken: string,
    window: DateWindow,
    label: string,
  ): Promise<CleanCloudCustomer[]> {
    const response = await httpRequest(
      `${CLEANCLOUD_BASE_URL}/getCustomer`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        // The token travels in the body, not a header — CleanCloud's own
        // examples do it this way, in both their PHP and Node flavours.
        body: JSON.stringify({
          api_token: apiToken,
          dateFrom: cleanCloudDate(window.from),
          dateTo: cleanCloudDate(window.to),
          excludeDeactivated: EXCLUDE_DEACTIVATED,
        }),
      },
      { maxAttempts: CUSTOMER_ATTEMPTS, label },
    );

    if (!response.ok) {
      const detail = await upstreamDetail(response, { secrets: [apiToken] });
      if (response.status === 401 || response.status === 403) {
        throw new UnauthorizedException(
          withUpstreamDetail("CleanCloud rejected the API token", detail),
        );
      }
      throw new BadGatewayException(
        withUpstreamDetail(`CleanCloud request failed (${response.status})`, detail),
      );
    }

    // A body that is not JSON at all is a failure of the same kind as a 502 —
    // and an unparsed one would otherwise surface as a raw SyntaxError.
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new BadGatewayException("CleanCloud returned a response that was not JSON");
    }
    return extractCustomers(body);
  }
}
