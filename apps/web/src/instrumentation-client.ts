// Browser-side error monitoring.
//
// The Sentry SDK is loaded via a dynamic `import()` rather than a top-level
// static import, so it splits into its own lazily-fetched chunk instead of
// riding in the shared framework bundle that EVERY page — including the static
// marketing pages that have no auth and little error surface — downloads and
// parses on first load. It's fetched only when a DSN is configured (i.e. in
// production) and only after hydration.
//
// Trade-off: an error thrown in the first few moments before the chunk resolves
// could be missed. That's acceptable here because we run error capture only
// (`tracesSampleRate: 0`, no performance tracing), so the cost is a negligibly
// smaller capture window in exchange for a lighter bundle on every page.

// Type-only import — fully erased at compile time, so it adds nothing to the
// bundle. Lets us type the router-transition wrapper precisely without pulling
// the SDK into this module's static graph.
import type * as SentryClient from "@sentry/nextjs";

type RouterTransitionStart = typeof SentryClient.captureRouterTransitionStart;

// Set once the SDK has loaded and initialised; until then the exported wrapper
// below is a no-op (harmless — router-transition tracing produces nothing with
// tracesSampleRate at 0 anyway).
let routerTransitionStart: RouterTransitionStart | undefined;

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0,
    });
    routerTransitionStart = Sentry.captureRouterTransitionStart;
  });
}

// Next imports this statically to wire navigation instrumentation, so it must be
// a real synchronous export. Forward to the SDK's handler once it's loaded.
export const onRouterTransitionStart: RouterTransitionStart = (...args) => {
  routerTransitionStart?.(...args);
};
