# 0175 — Component tests for the screens where a mistake costs money

## Status

Accepted — implemented.

## Context

`apps/web` is the largest package in the platform and had no tests at all.

| Package        |  Lines | Test files |
| -------------- | -----: | ---------: |
| `apps/web`     | 39,369 |      **0** |
| `apps/api`     | 31,225 |        118 |
| `shared-types` |  5,347 |          — |

`pnpm test` for the web app ran a design-token checker: useful, but not a test
of behaviour. Ninety-six client components — the whole interactive surface —
were unguarded.

This was not theoretical. In one week the untested layer produced:

- a status tab that carried a deadline filter into a screen that could not show
  it, so the list disagreed with the count directly above it;
- a send screen that printed occasion dates in a sentence claiming cards posted
  on them, five working days out;
- an approvals queue where skipping was a one-way door, which cost a school ten
  birthdays.

Each was found by hand, verified in a browser, and then left with nothing to
stop it coming back. The checks lived in a scratchpad and evaporated.

## Decision

**A small suite over the screens where a mistake costs money or loses a
birthday** — Approvals, the send-timing picker, checkout, and the truncation
notice. Twenty-four tests, not a coverage target.

Covering 39,000 lines would be a year of work with a poor return, most of it
markup. These four are where the money is spent, the birthdays are lost, and
every one of the week's bugs actually landed.

**Jest with `next/jest`**, matching the API's runner rather than introducing a
second one. `next/jest` supplies the SWC transform, CSS and font stubs, so there
is no bespoke transform config to drift from the app's own build.

Two things it does not supply, both discovered rather than assumed:

- **The `@/` alias.** It configures SWC's transform; Jest's _resolver_ still
  needs a `moduleNameMapper`. Verified against `jest --showConfig`: seven
  mappings, none of them the project's own.
- **Environment variables.** `src/lib/env.ts` parses on import and throws when
  one is missing, so any component reaching `@/lib/api` needs them before its
  module graph loads — hence `setupFiles`, not `setupFilesAfterEnv`. They are
  committed as code rather than kept in a `.env.test`, because `.env*` is
  gitignored: a local-only file would pass here and fail in CI. Every value is a
  visible placeholder; no component test may reach a real service, so a working
  key would be a liability rather than a convenience.

### What this deliberately cannot do

**It cannot see a hydration mismatch.** jsdom runs in Node, so both "server" and
"client" share Node's ICU and agree with each other by construction. The
Node-versus-browser date divergence that bit twice this week — `weekday + day +
month` differs, and adding `year` makes it agree again — is found by running two
real engines, and that check is not replaced by anything here.

**It cannot find a wrong idea.** The send screen showed occasion dates labelled
as posting dates. A test written by the same person holding the same wrong idea
asserts the wrong string just as confidently. These lock in behaviour once it is
understood; they do not discover that the behaviour was misconceived.

**It does not cover server components.** Async RSCs are awkward to render in
isolation. The client components are the realistic target, and are where the
bugs were.

## Consequences

`pnpm test` for the web app now runs the token check _and_ Jest, so CI fails on a
regression in these four screens rather than a person noticing weeks later.

Dates in the tests are computed with the same engine the order uses rather than
hard-coded, so they keep asserting the truth as the calendar moves instead of
going stale and being rewritten to match whatever the code now does.

Verified by mutation, each fault caught by a distinct set:

| Mutation                                             | Tests failed |
| ---------------------------------------------------- | -----------: |
| Truncation notice never stays silent                 |            5 |
| Send timing prints the occasion date as the post day |            1 |
| Skipping stops being undoable                        |            2 |
| A partly-failed bulk skip loses its successes        |            3 |
| Checkout's per-order cap off by one                  |            1 |
