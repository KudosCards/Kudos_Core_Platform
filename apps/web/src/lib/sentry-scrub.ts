import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { redactUrl } from "@kudos/shared-types";

/**
 * Page routes whose URL *path* carries a bearer-equivalent secret.
 *
 * These are the web's own routes, not the API's: the API's
 * `/invites/<token>/accept` is reached from this app's `/invite/<token>`, and a
 * list built for one does not cover the other. Listed as prefixes rather than
 * matched by shape — a token has no distinguishing format.
 */
export const WEB_TOKEN_PATH_PREFIXES = ["/invite/", "/rts/"] as const;

/**
 * API paths this app fetches, so a breadcrumb recording the request is scrubbed
 * too. A `fetch` breadcrumb carries the absolute API URL, which is where the
 * token actually travels.
 */
export const API_TOKEN_PATH_PREFIXES = ["/invites/", "/rts/", "/guest/claim/"] as const;

const ALL_TOKEN_PATH_PREFIXES = [...WEB_TOKEN_PATH_PREFIXES, ...API_TOKEN_PATH_PREFIXES];

/** Redact any token this app can put in a URL, page route or API call. */
export function redactWebUrl(url: string): string {
  return redactUrl(url, ALL_TOKEN_PATH_PREFIXES);
}

/** Keys under which the SDK records a URL on a breadcrumb: `url` for fetch and
 *  xhr, `from`/`to` for a navigation. */
const BREADCRUMB_URL_KEYS = ["url", "from", "to"] as const;

/**
 * Sentry's `beforeSend`. The event's request URL is the page the error happened
 * on, which for every public token-bearing route is the credential itself.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request?.url) {
    event.request.url = redactWebUrl(event.request.url);
  }
  return event;
}

/**
 * Sentry's `beforeBreadcrumb`. Breadcrumbs are the reason this matters more on
 * the client than the server: an error anywhere in the session ships the
 * navigation trail that led to it, so a token from a page the user visited ten
 * minutes ago rides along with an unrelated crash.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (!breadcrumb.data) {
    return breadcrumb;
  }
  const data = { ...breadcrumb.data };
  let changed = false;
  for (const key of BREADCRUMB_URL_KEYS) {
    const value = data[key];
    if (typeof value === "string") {
      data[key] = redactWebUrl(value);
      changed = true;
    }
  }
  return changed ? { ...breadcrumb, data } : breadcrumb;
}
