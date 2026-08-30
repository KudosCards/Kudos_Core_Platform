# 0206 — Every route needs a way out

## Status

Accepted — implemented. From an external code review (finding 35 of 37).

## Context

`serverApiFetch` throws on any non-2xx. So an API 5xx while a page is loading is
not an empty state to render around — it is a render error, and where it lands
depends entirely on which boundaries exist.

One did: `app/(app)/error.tsx`. Nothing covered `(ops)`, `(auth)`, the public
marketing and legal routes, or the root layout itself.

An operator opening `/fulfillment` during an API blip was dropped onto Next's
bare default error screen: no branding, no explanation, no retry, and — the part
that matters most — **nothing reported to Sentry**, because the reporting lives
in the boundary. The failure the customer saw was the failure nobody heard
about.

## Decision

Four boundaries added, and one component behind all five:

| File                   | Catches                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| `app/error.tsx`        | everything without its own boundary — marketing, legal, basket, card library |
| `app/(ops)/error.tsx`  | the ops queue and cockpit                                                    |
| `app/(auth)/error.tsx` | sign-in and sign-up                                                          |
| `app/global-error.tsx` | the root layout itself                                                       |
| `app/(app)/error.tsx`  | unchanged in behaviour, rewritten to use the shared screen                   |

`components/error-screen.tsx` holds the markup and the Sentry reporting.
Five near-identical files is the duplication this review has spent a dozen
findings on; each boundary is now a thin client component that supplies its own
words.

**The words differ on purpose.** The ops boundary does not say "something went
wrong" — an operator's next decision is whether to keep working from a screen
that may be stale, so it says the API did not answer, that nothing was changed,
and to check the API before trusting what is still on screen. A customer needs
reassurance; an operator needs to know what they can still rely on.

`global-error.tsx` renders its own `<html>` and `<body>`: the root layout is the
thing that failed, so it cannot supply them. Its fonts are gone with it, and it
renders in the browser's default face rather than pretending otherwise.

The error digest is shown. It is the only handle support has on a specific
failure — what ties a customer's screenshot to a Sentry event.

## Consequences

- A 5xx anywhere renders a page a person can read and press a button on.
- Every such failure reaches Sentry. Previously only the authenticated app's did.

Four mutations were run. Swallowing the Sentry report and disconnecting "Try
again" each fail all five boundaries — the test is parameterised over them, so a
regression in the shared screen cannot hide in one route group. Deleting the ops
boundary fails the suite outright.

## The mutation that is not caught

Removing `global-error.tsx`'s own `<html>`/`<body>` is not caught: jsdom renders
the fragment perfectly well, and the reason those tags are required — that
`global-error` _replaces_ the root layout — is a Next.js runtime rule, not
something a component test can observe.

Recorded rather than counted. Verifying it would need a real Next build serving
a root-layout failure, which is worth doing as part of a broader end-to-end
smoke suite rather than pretended at here.
