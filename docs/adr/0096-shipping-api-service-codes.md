# 0096 — Shipping API v4 direct dispatch: configurable service codes

## Status

Accepted

## Context

ADR 0072 added the Royal Mail **Shipping API v4** direct-dispatch path: an
operator clicks "Dispatch (Royal Mail)" on a printed card and the platform
creates the shipment server-side (buys postage, stores tracking + label). It was
built but never enabled, and it hard-coded the per-postage-class **service
codes** (`TPN01` / `TPS01`) with a comment that they're account-specific and
"must be confirmed against the live account before go-live".

Those exact codes vary by Royal Mail account and can only be confirmed live (this
sandbox has no Royal Mail egress). Hard-coding them means the single most likely
first-dispatch failure — a wrong service code — would require a **code change +
redeploy** to fix, during go-live, which is the worst time for a slow loop. This
is the companion to ADR 0095 (Click & Drop import); the operator wants both Royal
Mail paths usable.

## Decision

Make the Shipping API service codes **env-overridable without a redeploy**, and
document both Royal Mail integrations' enablement in the go-live runbook.

1. **`ROYAL_MAIL_SERVICE_CODE_FIRST` / `_SECOND`.** The `HttpRoyalMailClient` now
   takes an optional per-class service-code map (wired from these env vars by its
   provider) and falls back to the existing `TPN01` / `TPS01` defaults when
   unset. So the correct codes can be set (or corrected) from Railway the moment
   they're confirmed, with no build. The stable client interface is unchanged.

2. **Runbook section 4c** now documents both Royal Mail options side by side —
   Click & Drop import (ADR 0095) and Shipping API direct dispatch (this) — as
   independent, key-gated, "verify live after deploy" integrations, each with its
   first-live-check step, plus the new env vars in the Railway table.

Nothing about the dispatch flow, its manual "printed → dispatch → posted"
gating, or the error surfacing changes — only where the service codes come from.

## Consequences

- The direct-dispatch path is production-ready: enabling it is setting
  `ROYAL_MAIL_API_KEY`, and correcting a wrong service code is an env change, not
  a deploy.
- The two Royal Mail integrations are cleanly separated and both documented, so
  the operator can run either or both.
- Still requires the same post-deploy live check as Stripe/Click & Drop — the
  request shape and codes are only truly verifiable against the real account; the
  error (status + Royal Mail's message) surfaces to the operator when it's wrong.
