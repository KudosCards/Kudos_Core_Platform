# 0263 — Asking a model for words

## Status

Accepted

## Context

Phase D6 of `docs/click-and-forget-improvements-plan.md`, and the first time
this codebase has called a language model.

The message pool is written by hand. Twenty boxes and a blank page is a real
barrier for somebody who has just been asked to hand over their birthdays, and
"stuck for words" is the commonest reason a pool ends up with one message in it
— which means everybody gets the same card.

`source: "assisted"` has been in the schema since C4 (ADR 0256) and nothing has
ever written it. This writes it.

The owner chose Anthropic over the alternative offered — a curated house bank
of messages with no vendor at all — and has put `ANTHROPIC_API_KEY` on the API
service. Reviewing Anthropic's commercial terms and data-processing agreement
is theirs and is not a code question; what follows is the part that is.

## Decision

### No contact data is in the prompt, and that is structural

Two strings go up: the subscriber's own business name, and a short brief they
typed. That is the whole input. `draftBirthdayMessages` takes a `DraftRequest`
of exactly `{ businessName, brief }`, so there is no field a contact could
arrive in — this is a property of the shape rather than a promise kept by care.

It works because a drafted message is a **template**, not a message: it carries
`{firstName}`, and the name is filled in by the print run weeks later
(ADR 0031). The model never learns who anybody is, and the same draft serves
every contact in the pool.

Two consequences worth stating:

- **A personal account sends no name at all.** On an `individual` account the
  account name is somebody's actual name. A feature whose safety argument is
  "no personal data is in the prompt" does not get an exception for the one
  person who did not ask to be in it.
- **The e2e proves it against the bytes.** It creates a contact with a
  distinctive name, address and birth year, asks for drafts, and asserts none
  of those strings appear in what was sent — and that the request has exactly
  two fields. A third field added later has to come through that test.

### Dark until configured

No `ANTHROPIC_API_KEY` means the provider hands over `null`, the standing-order
payload reports `messageDraftingAvailable: false`, and the page renders no
button. The route still answers — with a plain 503 — because a stale tab and a
curl deserve the truth rather than a pretend draft.

This is what let D1–D5 ship without waiting for a key, and it is the same
convention every other optional integration here uses.

### A provider, not a `new` in the service

`MESSAGE_DRAFTER` is a token bound by a factory, the way `STRIPE_CLIENT`,
`JWKS_RESOLVER` and `CATALOG_SOURCE` are. That is not only tidiness: the first
version built the client inline from config, and the e2e — which sets a stub
base URL — reached **the real Anthropic API** and came back with "API key is
invalid". A test suite that can call a vendor is a test suite that will, and
nobody consented to that. Now an e2e swaps the provider and the network is
unreachable by construction.

### Bounded in three places, for two different reasons

- **Twenty drafting requests per account per rolling day**, counted from
  `AuditLogEntry` — which is written on every _successful_ draft, so there is no
  second table to keep honest and a failed call never spends somebody's
  allowance. This is what bounds the bill.
- **A route throttle**, deliberately loose at twenty a minute. The throttler
  keys on the caller's IP and a centre's staff share one office connection, so a
  tight limit here would punish the wrong thing. It exists to stop a stuck
  client, not to ration.
- **`max_tokens`**, because six short messages need nothing like it and a
  ceiling on a bill is cheaper than a conversation about one.

The model id is pinned exactly — `claude-haiku-4-5-20251001` — rather than to a
moving alias, and is overridable by env so a change of model is a variable and
not a release. What it writes gets printed on paper; "whatever is current" is
not something to discover from a customer's card.

### The reply is untrusted text

It is asked for a bare JSON array and told not to wrap it, and it is still read
with a tolerance for a code fence or a sentence of preamble, because asking
politely is not a parser. Every draft is then trimmed, checked against the same
length a typed message must satisfy, deduplicated, and capped at the six that
were asked for. A draft that fails is **dropped rather than shown**: showing it
and letting the save refuse it later would put the model's mistake in the
subscriber's lap.

If nothing survives, that is a refusal, not an empty box.

### Suggestions are suggestions

Drafts land in a list beside the pool. Nothing is written into the pool, nothing
replaces what is already there, and nothing is saved until the subscriber saves
the page with the same button as everything else. A kept draft is recorded as
`assisted`; one they typed stays `written`. That distinction is the whole reason
the column exists — a message somebody accepted from a model is not the same
promise as one they wrote — and the page is now the only place that can still
tell the difference, so it is pinned by a test.

The system prompt forbids three things, each for a reason: no invented names,
ages or dates, because a pool message is reused for years and for everybody in
it; no promises of discounts or gifts, because a card that offers something the
business did not agree to is worse than a dull card; and no emoji or sign-off,
because these are printed inside a card, not sent as an email.

### Failing is a bell, not a siren

A model that cannot be reached tells the subscriber plainly, leaves their own
messages untouched, and raises a super-admin alert — the same escalation
auto-send and the wallet use. A reply we could not parse is logged and not
escalated: that is a prompt that has stopped working, not an outage, and it
needs a person reading logs rather than a bell at 3am.

Nobody loses a card over any of this. The button is the only thing that stops.

## Consequences

- The first outside model in the product, reachable only through the repo's own
  `httpRequest` — deadline, bounded retry, `Retry-After` — like every other
  outbound call, and enforced by the `no-bare-fetch` guard.
- `GET /standing-order` gains `messageDraftingAvailable`, a fact about the
  deployment rather than the instruction. It lives there because this page is
  the only thing that asks.
- Drafting is not free. Twenty requests per account per day is the ceiling, and
  it is a number worth revisiting once there is any evidence about how often the
  button is actually pressed.
- Nothing about **card** selection uses a model, and nothing here reads a
  contact. If that ever changes it is a new decision and a new agreement, not an
  extension of this one.
