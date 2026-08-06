# 0125 — Explicit resume intent closes a concurrent-checkout double-session race

## Status

Accepted

## Context

`POST /batch-orders/:id/checkout` mints a Stripe Checkout Session for a batch
order. To stop two near-simultaneous checkouts of the same order from each
creating a live, payable Stripe session (a double-charge risk), the endpoint
guards the state transition **before** calling Stripe: it atomically flips the
order `draft → pending_payment` with a conditional `updateMany` (a
compare-and-swap on `status`). The loser's CAS matches zero rows and is rejected
with 409, so only one request ever reaches Stripe.

ADR 0119-era work added a **resume** path (PR #210): if the buyer starts
checkout but closes the Stripe page without paying, the order is stranded in
`pending_payment` with no live session. "Resume checkout" hits the same endpoint
again and must be allowed to mint a *fresh* session — so the endpoint began
accepting `pending_payment` orders, not just `draft`.

That reopened the double-session hole. A `draft` order checked out twice
concurrently can interleave as:

1. **T1** wins the CAS (`draft → pending_payment`), calls Stripe, returns 201.
2. **T2** reads the order *after* T1 committed, sees `pending_payment`, and —
   because the endpoint now treats any `pending_payment` order as resumable —
   **skips the guard entirely**, calls Stripe a second time, and also returns
   201.

Result: two live sessions for one order. A concurrency e2e test
(`rejects checking out a batch order twice concurrently`) caught this
intermittently (~1 in 3–4 runs) — the outcome depended purely on whether T2's
read landed before or after T1's commit.

The root difficulty: a legitimate **resume** and an illegitimate **concurrent
double-submit** are *indistinguishable by stored state*. Both are a second
checkout of a `pending_payment` order; they differ only in timing. No status
column, lock, or optimistic-version check can separate "T2 raced the initial
checkout" from "the user came back an hour later" — because in the failing
interleaving T2 reads a fully-settled `pending_payment` row that looks exactly
like an abandoned one.

## Decision

Make the caller **declare its intent**. The `pending_payment` (resume) branch is
entered only when the request carries `{ resume: true }`; a first checkout omits
it. The UI already encodes this distinction — the **Pay** button (first
checkout) versus the **Resume checkout** button on the unfinished-orders list —
so only the latter sends the flag.

Concretely, in `BatchOrdersService.checkout`:

- `status === "draft"` → CAS `draft → pending_payment` as before (a first
  checkout; the `resume` flag is irrelevant here).
- `status === "pending_payment"`:
  - **no `resume` intent** → 409. This is the safety net for the concurrent
    double-submit: T2 reads `pending_payment` but, being an unflagged first
    checkout, is rejected instead of misread as a resume. Two racing *Pay*
    clicks therefore always resolve to exactly one session.
  - **`resume` intent** → allowed, but still guarded by a compare-and-swap on
    `(status, updatedAt)`. `@updatedAt` bumps on every write, so two concurrent
    *resume* clicks of the same snapshot collide — the loser's `updatedAt` no
    longer matches and it 409s. This closes the symmetric double-*Resume* race
    too.
- anything past payment (`paid`/`fulfilling`/`completed`) or `cancelled` → 409,
  unchanged.

Only the deliberate, sequential act of clicking Resume after a first session was
abandoned — genuinely non-concurrent — mints a second session, which is exactly
the intended resume behaviour.

### Surfaces touched

- `apps/api/src/batch-orders/dto/checkout-batch-order.dto.ts` — new
  `CheckoutBatchOrderDto { resume?: boolean }`.
- `apps/api/src/batch-orders/batch-orders.controller.ts` — bind the body, pass
  `resume` through.
- `apps/api/src/batch-orders/batch-orders.service.ts` — the guard logic above.
- `apps/web/.../batch-orders-client.tsx` — the Resume button sends
  `{ resume: true }`; every first-checkout caller is unchanged (no body).

Guest checkout (`GuestOrdersService`) freshly creates a `draft` order and checks
it out immediately with no `resume` flag, so it takes the `draft` CAS path —
unaffected.

## Consequences

- The concurrent-double-submit test is now deterministic; the double-session /
  double-charge risk on the initial checkout is closed.
- A first checkout is now the *only* unflagged path. Any client that re-POSTs
  checkout on a `pending_payment` order without `{ resume: true }` gets a 409 —
  an intentional contract change. The one such caller (the Resume button) sends
  the flag; a stray retry of a first checkout correctly fails closed.
- The distinction is client-declared, which is acceptable: a client that always
  sends `resume: true` can at worst mint extra sessions for *its own* order, all
  keyed to the same `batchOrderId`; the Stripe webhook settles that order
  idempotently, so no second charge lands. The flag removes an *accidental*
  double-session, which is the realistic failure mode (a double-click), not a
  security boundary.
