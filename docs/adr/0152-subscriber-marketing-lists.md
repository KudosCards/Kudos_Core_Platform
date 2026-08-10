# 0152 — Sync subscribers into our Brevo marketing lists (personal vs organisation)

## Status

Accepted — implemented.

## Context

We want every new Kudos Cards subscriber captured in our own **Brevo account** as
a marketing contact, split into two lists so personal and organisational
audiences can be messaged separately as we grow:

- **Individuals** (personal use) → Brevo list **5**
- **Organisations / companies** → Brevo list **6**

…capturing at least email, and — where we have it — name and surname (individuals)
or company name (organisations).

There is already a Brevo integration in the codebase, but it points the other
way: `integrations/brevo` uses a **per-customer** API key to *read* that
customer's contacts into Kudos (CRM import, ADR 0015). This feature is the
opposite direction — using our **platform** Brevo key (the same `Brevo_API` that
sends transactional email) to *write* our subscribers into our marketing lists.
So it's a new, separate client, not a reuse of the CRM one.

## Decision

Add a small `marketing` module that, on signup, upserts the new account owner
into the Brevo list for their account type.

- **Where it hooks in — server-side, in `AccountsService.signup`.** Every signup
  path funnels through this one service method (the inline register flow, the
  deferred email-confirmation flow via `/onboarding`, and any future path), so a
  single call site covers them all. Doing it in the API rather than the web forms
  means no change to the conversion funnel and no risk to the three web
  account-creation call sites.
- **Best-effort, never blocking.** `MarketingContactsService.syncSubscriber`
  swallows and logs any error. A Brevo hiccup must never fail a signup; a missed
  list write is recoverable (re-runnable via a backfill), a failed signup is not.
  The upsert runs after the account+membership transaction commits.
- **Mockable client behind a token.** `MARKETING_CONTACTS_CLIENT` mirrors
  `EMAIL_CLIENT` / `STRIPE_CLIENT`: a real `fetch`-based implementation
  (`POST /v3/contacts`, `updateEnabled: true` so it's an idempotent upsert keyed
  on email), a no-op when `Brevo_API` is unset (app still boots, signup still
  works), and an override in e2e tests so nothing hits the network.
- **List ids are env-configurable, defaulting to the real values.**
  `BREVO_LIST_ID_INDIVIDUAL` (default **5**) and `BREVO_LIST_ID_ORGANISATION`
  (default **6**). Defaults mean it works out-of-the-box; envs let a different
  environment point elsewhere without a code change.
- **Name capture — derive from what we already collect.** Signup captures one
  `name` field (a person's name for individuals, the company name for orgs). A
  pure helper (`deriveContactName`) maps it to Brevo's `FIRSTNAME` / `LASTNAME`
  (individuals: split on the last space, so the surname is the final token) /
  `COMPANY` (organisations). This ships the two lists immediately with no funnel
  change; explicit first/last-name fields at signup are a clean follow-up that
  callers can feed straight through the same client.

## Consequences

- New subscribers land in the correct Brevo list automatically, with email plus
  best-effort name/surname (individuals) or company name (organisations).
- No schema change, no migration; nothing new persisted in our DB (the sync reads
  `Account.type` + `name` we already store, so a **backfill** of existing accounts
  can re-derive the same way — offered as a follow-up, not in this change).
- Guest one-off buyers (accounts created via the Stripe webhook, not signup) are
  **not** synced here — they aren't registered subscribers until they claim their
  account, and claiming doesn't run `signup`. In scope for a later pass if wanted.
- Individual name/surname is a best-effort split of a free-text field. It's right
  for the overwhelmingly common "First Last" case; unusual names may split
  imperfectly until we capture first/last explicitly.
