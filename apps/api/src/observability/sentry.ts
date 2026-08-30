import * as Sentry from "@sentry/node";
import { redactUrlTokens } from "../common/redact-url-tokens";

/** Strip a URL down to its path so the prefix matcher can see it, then redact. */
export function redactMaybeAbsolute(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${redactUrlTokens(`${parsed.pathname}${parsed.search}`)}`;
  } catch {
    return redactUrlTokens(url);
  }
}

/**
 * Initialises Sentry error monitoring if SENTRY_DSN is set. A no-op otherwise,
 * so local/dev/test and any environment without a DSN behave exactly as before.
 * MUST be called before the Nest app is created (main.ts) so Sentry's automatic
 * instrumentation wraps everything. See docs/adr — reserved slot in env.schema.ts.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Errors only by default — no performance tracing overhead until we opt in.
    tracesSampleRate: 0,
    // The same secrets the log serializer strips also ride on Sentry's request
    // URL and its http breadcrumbs. An error report is another place logs end
    // up, with another set of people able to read them. See ADR 0187.
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = redactMaybeAbsolute(event.request.url);
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      const url = breadcrumb.data?.url;
      if (typeof url === "string") {
        breadcrumb.data = { ...breadcrumb.data, url: redactMaybeAbsolute(url) };
      }
      return breadcrumb;
    },
  });
}

export { Sentry };
