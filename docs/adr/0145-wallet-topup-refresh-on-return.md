# 0145 — Wallet top-up: live balance + working buttons on return from Stripe

## Status

Accepted — implemented. From early customer feedback (Wave 2).

## Context

A customer reported that after topping up the wallet, **returning from Stripe
left the "Add funds" buttons dead** until they manually refreshed the page. Two
separate problems produced this:

1. **Buttons stuck disabled.** `topUp()` sets `pendingAmount` (which disables the
   buttons and shows "Redirecting…") and then `window.location.assign()`s to
   Stripe Checkout. If the member presses the browser **Back** button from
   Stripe, the page is restored from the **back/forward cache (bfcache)** with
   React state intact — so `pendingAmount` is still set and every top-up button
   stays disabled. Only a hard refresh cleared it.

2. **Stale balance.** The top-up is credited by an **async Stripe webhook**, so
   the server-rendered balance on the `?topup=success` return can still show the
   old figure. The page even told the user to fix it themselves — _"Refresh if
   you don't see it yet."_

## Decision

Make the page self-heal on return instead of relying on a manual refresh.

- **Re-enable buttons on `pageshow`.** A `pageshow` listener resets
  `pendingAmount` to `null` whenever the page is shown — including bfcache
  restores (pressing Back from Stripe) and normal loads. The buttons are never
  left stuck.
- **Poll the balance briefly on success.** The balance + ledger now render from
  a `summary` state seeded by the server snapshot. On a `?topup=success` return,
  the client polls `GET /wallet` a few times (starting ~1.5s in, every 2s, up to
  6 attempts / ~12s) and stops as soon as the balance changes. A small spinner in
  the success banner shows it's updating; the "Refresh if you don't see it yet"
  copy is gone.

## Alternatives considered

- **Poll forever / websockets** for the credit — overkill for a rare action; the
  webhook lands within seconds, so a short bounded poll is enough and self-limits.
- **Read `pageshow.persisted` and only reset on bfcache restores** — resetting on
  every show is simpler and harmless (on a fresh load `pendingAmount` is already
  null), so no need to branch on it.

## Consequences

- Returning from a top-up "just works": buttons are live and the new balance
  appears on its own, no manual refresh. If the webhook is unusually slow (beyond
  the poll window) the balance still lands on the next navigation, as before —
  the poll is an enhancement, not a correctness dependency.
- Purely client-side; no API, schema, or dependency change. The webhook remains
  the source of truth for the credit (ADR 0080's idempotent crediting is
  unchanged) — this only changes when the client re-reads it.
