# ADR 0025 — Guest one-off purchases + three-tier account model

Status: **accepted** (owner approved the shape and resolved the open questions — see below)
Date: 2026-07-22

## Context

Today every path into Kudos requires creating an account before you can buy anything: browsing the
public card library is open, but clicking **"Personalise this card"** forces signup
(ADR 0017/0018). That's the right amount of friction for a tuition centre setting up automated
birthday cards for 100 students — but it's too much for a visitor who just wants to send *one*
card, once. We're leaving one-off sales on the table.

The decision (confirmed with the owner) is to **reduce friction for one-off purchases the way
Moonpig does**: a visitor can buy and send a single personalised card **without an account**, and
is *offered* — never forced — the chance to create one afterwards. Signing up is reserved for the
value that genuinely needs an identity: saving birthdays to a calendar, reminder notifications, and
automation.

Confirmed product decisions:
- **Pricing: £1.50 flat for everyone**, including one-off guests (VAT + postage inclusive, as
  today). Business plan discounts still apply to plan holders; guests have no plan, so they pay the
  full £1.50.
- **Three tiers** (guest → personal → business), with the personal tier aimed at **consumers who
  want to track their own friends' and family's birthdays**.

## The three journeys

| Journey | Account? | What it's for | What they get |
|---|---|---|---|
| **Guest one-off** | None (optional after) | "Send Grandma a card, now." | Personalise one card, we print & post it. Email receipt. Post-purchase nudge to save the contact. |
| **Personal** (`AccountType.individual`) | Sign up | A consumer tracking their own people | Saved contacts + birthday calendar, reminder notifications, optional auto-send. |
| **Business** (`AccountType.organisation`) | Sign up | Tuition centres, clubs, employers | Everything planned — bulk CSV/CRM import, team memberships, plans, API keys, auto-send at scale. |

The schema already anticipates this: `AccountType` is `individual | organisation`, and auth is a
separate `Membership` table — **an `Account` with zero memberships is, by definition, a guest** (an
account nobody has logged into). We don't need a new "guest" concept; we need to let an account
exist and transact before a membership is attached.

## How guest checkout works (the core of this ADR)

**Reuse `quick-send`, don't fork the money path.** `BatchOrdersService.quickSend` already
orchestrates the full chain — create a `Recipient`, an approved `Occasion`, a single-line
`BatchOrder`, then a Stripe Checkout session — for a logged-in account. A guest purchase is the
same chain with three differences:

1. It runs against a **freshly-minted guest account** (`type: individual`, no membership) instead
   of the session's account.
2. It's **unauthenticated** — a `@Public()` endpoint.
3. It **captures the buyer's email** (for the receipt and the later account-claim link).

### Guest flow, step by step
1. **Browse** `/cards` → **`/cards/[id]`** (already public).
2. **"Personalise & send"** (replaces the signup-gated CTA for guests): recipient's first name,
   the inside message, optional photo / QR video link, on the chosen design.
3. **Delivery**: recipient's postal name + address (`OrderRecipient` already stores this inline),
   plus the **buyer's email** (+ optional buyer name).
4. **Pay**: Stripe Checkout, one card, **£1.50 flat**. Stripe collects/[pre-fills] the email.
5. **Webhook → fulfilment**: the *existing* `checkout.session.completed` handler transitions the
   order to paid, creates the `FulfillmentJob` and the `MessagePage` — **no webhook changes**.
6. **Confirmation**: "Your card is on its way. Never miss their birthday again — create a free
   account and we'll remind you next year (and can send it for you)." → **claim** (below).

Because a guest order goes through `Recipient` + `Occasion` + `BatchOrder` on a real (guest)
account, when the guest later claims it, **their giftee is already saved** — "we kept Grandma for
you, her birthday's on your calendar." That's the conversion hook, for free.

## Account claiming (guest → personal account)

After payment (or later, from the emailed receipt), the guest can **claim** their guest account:
- They set a password / use a magic link via Supabase Auth for the **email captured at checkout**.
- On success we attach a `Membership(userId, guestAccountId, role: owner)` — the guest account is
  now a full personal account, with the purchased card and saved contact already in it.

**Security:** claiming must prove the buyer owns that email — we don't let anyone attach themselves
to an unclaimed account. The claim link carries a **signed, single-use token** tied to the Stripe
session/order; the API verifies the token *and* that Supabase confirmed the email before attaching
the membership. (Detail to finalise — see open questions.)

**Email collision:** if the checkout email already belongs to an existing account, we **don't**
claim the guest account — we route them to log in, and (v1) simply move the guest order + contact
onto their existing account. Full account-merge is out of scope for v1.

## Personal-account features that justify signup

- **Saved contacts + birthday calendar** — already built; individuals reuse it.
- **Reminder notifications** — *new capability* (see below).
- **Automation / auto-send** — already built (approve once, we send every year via the
  wallet/auto-send path); individuals reuse it.

## Reminder notifications (new, and the one real infra gap)

This is the headline reason a consumer signs up, and **we have no transactional email sender wired
today** — Brevo is integrated only as a contact *source*, not for sending. So this needs a
transactional email provider and a small sending service:
- A **daily cron** finds occasions a configurable lead time out for opted-in accounts and sends a
  reminder email ("Grandma's birthday is in 7 days — approve her card, or we'll auto-send it").
- Reuses the existing occasion/lead-time machinery; adds an email-send step and a per-account
  opt-in + quiet-hours/frequency guard.

Provider choice is an **open question** (below). This is a natural **separate phase** — the guest
flow doesn't depend on it.

## Data-model changes (small)

- `BatchOrder.createdByUserId` → **nullable** (a guest order has no user). Account orders keep it.
- `Account.contactEmail String?` — the guest buyer's email (receipt + claim + reminder target).
  For claimed/registered accounts this stays null (the membership's user carries identity).
- A **claim token** mechanism — likely a signed token rather than a stored column, or a nullable
  `Account.claimToken` + `claimTokenExpiresAt`. To finalise in implementation.
- No change to `OrderRecipient`, the webhook, fulfilment, or `MessagePage`.

## Auth / middleware / security

- The guest **personalise → delivery → checkout** web routes must be **public** (extend the
  existing public-path allowlist that already covers `/cards`).
- The guest-order + guest-checkout **API** endpoints are `@Public()` but **create-only and
  self-scoping**: they *always* mint a new guest account server-side and **never accept a
  client-supplied `accountId`** — a public endpoint must not be able to touch an existing account.
- **Payment before fulfilment** (unchanged) means no free cards even on a public endpoint.
- **Rate-limit** the public endpoints (guest-order creation) to prevent abuse/spam accounts.
- **Content moderation:** guests upload photos and free-text we print and post under the Kudos
  name. We should decide on a moderation stance (e.g. ops can hold/reject a fulfilment job — the
  queue already supports states). Flagged for the owner.
- **Consumer/distance-selling & VAT:** consumer sales differ from B2B. Stripe's receipt likely
  suffices, but we should confirm whether a VAT receipt/invoice to the buyer is required. Flagged.

## Phasing (once approved — one PR each, in order)

1. **Schema**: nullable `createdByUserId`, `Account.contactEmail`, claim-token mechanism +
   migration.
2. **API — guest checkout**: `@Public()` guest-order + guest-checkout endpoints (mint guest
   account, single-line order via the `quickSend` internals, Stripe session with buyer email,
   £1.50 flat), rate-limited. e2e tests against the mocked Stripe client.
3. **Web — guest flow**: public personalise → delivery → Stripe redirect; success/claim
   confirmation page. Change the `/cards/[id]` CTA so guests aren't signup-gated.
4. **Account claim**: claim endpoint + web signup that attaches a membership to the guest account
   (or routes an existing-email buyer to login and moves the order).
5. **Reminder notifications**: transactional email provider + send service + daily cron + per-
   account opt-in. (Own phase; provider TBD.)
6. **Personal-account polish**: an `individual` signup path and "add your first birthday"
   onboarding distinct from the business `/get-started`.

## Resolved decisions (owner)

1. **Transactional email provider: Brevo.** We reuse the existing Brevo account/integration — Brevo
   already ships as a dependency for CRM contact sync, so reminders (and any guest receipt beyond
   Stripe's) go through Brevo's transactional email API. No new vendor. Isolated to the reminders
   phase; the sending client is mockable in tests the same way the Brevo *source* client already is.
2. **Content moderation: hands-off.** No ops hold/approve step on guest-supplied photos/messages;
   we rely on Stripe payment + terms of service. (The fulfilment queue already supports a hold
   state, so a moderation step can be added later if abuse materialises — but it is out of scope
   now.)
3. **Receipt: Stripe's emailed receipt is sufficient for guests.** No formal VAT invoice for one-off
   guest purchases. A proper VAT invoice is a **business-subscription** feature — if a buyer needs
   invoices, that's a reason to sign up for a business account. So invoicing is not part of the
   guest flow.
4. **Claim-link security: signed single-use token tied to the Stripe session.** Approved. The claim
   link carries a signed, single-use token bound to the Stripe checkout session / order; the API
   verifies the token *and* Supabase's email confirmation before attaching a membership.

## Implementation notes

**Phase 1 (schema) — landed.** `BatchOrder.createdByUserId` is now nullable; `Account` gained
`contactEmail`, `claimToken` (`@unique`), and `claimTokenExpiresAt`.

- **Claim token: a stored, unique, nullable column** (`Account.claimToken`) rather than a purely
  signed/stateless token. Chosen because a stored token gives *true* single-use and revocation for
  free — the claim flow (Phase 4) nulls the column on use/expiry, so a spent or revoked link simply
  finds no matching row, with no separate blocklist to maintain. `claimTokenExpiresAt` bounds its
  lifetime.
- **The token is a secret and never leaves the API.** `AccountsService.findById` (which backs
  `GET /accounts/me`) uses an explicit `select` of the safe columns, so the token is never fetched
  into a response object. An e2e test asserts the endpoint body carries no trace of it.

**Phase 2 (API guest checkout) — landed.** A `@Public()` `POST /guest/checkout` (in a new `guest`
module) lets an unauthenticated visitor buy and send one card.

- **The money path is reused, not copied.** The shared `recipients.create`, `batchOrders.quickSend`,
  `batchOrders.create`, and `batchOrders.checkout` now accept `actorUserId: string | null`. A guest
  passes `null` → `BatchOrder.createdByUserId` is null and the audit writes are skipped (the audit
  actor column is NOT NULL, and a guest has no user to attribute; the order/account rows are the
  record). Pricing, the approved→queued transition, and cap checks are identical to the account
  path — `GuestOrdersService` just mints a guest account (`individual`, `free` plan → flat £1.50,
  no discount), saves the personalised design under it, then calls the same `quickSend` + `checkout`.
- **Create-only and self-scoping.** The DTO carries **no `accountId`** — the endpoint always mints a
  fresh guest account server-side, so a public caller can never aim an order at an existing account.
  `checkout` gained an optional `customerEmail` to prefill the buyer's email into the Stripe session.
- **Rate-limited** at 10/min per IP (ThrottlerGuard), mirroring the public message-page route.
- **The webhook is unchanged.** `checkout.session.completed` fulfils by `batchOrderId` alone and
  never touches `createdByUserId` or a membership, so a guest order fulfils exactly like any other.
- e2e tests cover the happy path (guest account minted with no membership, `createdByUserId` null,
  flat £1.50, buyer email handed to Stripe), per-purchase account isolation, and input validation.

**Phase 3 (web guest flow) — landed.** The public buy-without-signup journey.

- **The `/cards/[id]` CTA is no longer a paywall.** A logged-out visitor who clicks "Personalise
  this card" now goes straight to the guest send flow (`/cards/[id]/send`) instead of being routed
  into sign-up; a signed-in visitor still goes to the editor. The send page keeps a "create a free
  account instead" link (carrying `?card=`) for anyone who'd rather sign up.
- **`/cards/[id]/send`** (public — already covered by the `/cards/` allowlist) shows the chosen card
  beside a short form (recipient + delivery address + buyer email) and POSTs to `/guest/checkout`
  via a new `publicApiPost` helper, then redirects to Stripe. For this phase the card prints from
  the template as-is; an in-card personalisation editor for guests is a possible follow-up.
- **Public Stripe return pages** `/gift/success` and `/gift/cancelled` (added to the middleware
  allowlist — a guest has no session). Guest checkout now passes these as the Stripe
  `success_url`/`cancel_url` via new `successPath`/`cancelPath` options on `batchOrders.checkout`
  (account checkout still defaults to the authenticated `/batch-orders/*` pages). The success page
  confirms the order and nudges toward an account; the actual account-claim lands in Phase 4.

**Phase 4 (account claim) — landed.** A guest can turn their purchase into a personal account.

- **`GET /guest/claim/:token`** (public, throttled) returns the email a token is tied to, to prefill
  the claim form and detect an expired/spent link. **`POST /guest/claim`** (authenticated — the
  global guard supplies the confirmed Supabase user) attaches a `Membership` to the guest account,
  then nulls the token (single-use). Guards: token valid + unexpired; the user's email must match
  the order's `contactEmail`; and the user must not already own an account (the "already have an
  account" case returns a clear 409 — moving a guest order across accounts is a documented later
  enhancement). The claim token never leaves the API (findById/claim both use `SAFE_ACCOUNT_SELECT`).
- **Delivering the token:** guest checkout now appends `?claim=<token>` to the Stripe `success_url`
  (via a new `successExtraParams` option on `batchOrders.checkout`), so `/gift/success` can offer
  claiming immediately. The same link will go in the Brevo receipt in Phase 5.
- **Web:** `/gift/claim` (public) prefills the email and takes a password → Supabase sign-up →
  `POST /guest/claim`. The email-confirmation case is handled without losing the claim: the token is
  stashed (`pending-claim`) and `/onboarding` (already the no-account fallback) completes the claim
  after the user confirms and logs in, instead of showing the create-account form.
- e2e: claim attaches membership + spends the token + `/accounts/me` then resolves; single-use
  (second claim 404s); email-mismatch 403; already-has-account 409; unknown-token prefill 404.

**Phase 5 (transactional email + birthday reminders) — landed.** Stands up transactional email and
uses it for the headline personal-account feature.

- **Email infrastructure:** `EMAIL_CLIENT` (interface + injectable token, mockable like
  `BREVO_CLIENT`/`STRIPE_CLIENT`) with a real Brevo transactional impl and a **no-op fallback** when
  `BREVO_API_KEY`/`EMAIL_FROM_ADDRESS` are unset — so the API boots and reminders simply don't send
  until it's configured in the environment. New optional env: `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`,
  `EMAIL_FROM_NAME`.
- **Reminders:** a daily cron (`RemindersService`, 8am after the scheduler/auto-send) emails each
  opted-in account a single digest of birthdays in the next 7 days, with a link to the calendar.
  `Occasion.reminderSentAt` dedupes so an occasion is never emailed twice; a per-account send
  failure is logged and retried next run (its occasions aren't marked). New schema:
  `Occasion.reminderSentAt`, `Account.reminderEmailsEnabled` (opt-out, default on).
- **Recipients:** the signing-up user's email is now stored as `Account.contactEmail` (reminders
  need a target); it was already set for guest-claimed accounts.
- **Opt-out:** `PATCH /accounts/me/notifications` + a toggle on the billing page;
  `reminderEmailsEnabled` is exposed on the account so the UI reflects state.
- e2e (against a mocked email client): an opted-in account gets exactly one digest and only once
  (dedupe); an opted-out account gets none; a birthday outside the window gets none.

**Phase 5b (guest receipt email) — landed.** On `checkout.session.completed` for a guest order (the
account still has a claim token + contact email), the webhook emails the buyer their receipt with
the account-claim link — so a buyer who closed the success tab can still claim. Sent **after** the
fulfilment transaction commits and **only on the first delivery** (`fulfilled === true`), so a
redelivered webhook never re-emails; best-effort (a send failure is logged, not thrown — payment and
fulfilment already succeeded, and the link is also on the success page). e2e asserts the guest gets
exactly one receipt carrying the claim token, and none on redelivery.

**Cannot be verified from this sandbox:** real Brevo delivery (no network path to Brevo, same as
Stripe/Supabase). Needs `Brevo_API` + a verified sender in Railway and a live test.

**Phase 6 (personal-account onboarding) — landed.** The signup + onboarding now adapt to who the
account is for.

- **Signup** (`/register`) and the email-confirmation fallback (`/onboarding`) gained a "Who's this
  for?" choice — **Just for me** (`individual`) vs **My organisation** (`organisation`) — instead of
  hard-coding `organisation`. The name field label follows the choice ("Your name" vs "Organisation
  name"). Default stays `organisation` to preserve the existing business flow; the default can be
  revisited once consumer traffic is understood.
- **`/get-started`** is now account-type-aware. A personal account leads with **"Add your first
  birthday"** — a single name-and-date add form, with spreadsheet import demoted to a
  *"Got a lot of people?"* disclosure and no CRM callout — rather than the business bulk-import hero.
  Business accounts are unchanged.
- Claimed guest accounts (already `individual`) now land in this lighter, consumer-appropriate
  onboarding automatically.

This completes ADR 0025 end-to-end: guest → personal → business, no-signup buy, account claim,
reminders, receipts, and a signup/onboarding that fits each tier.

**Brevo hookup — landed.** The transactional sender is now wired to the platform Brevo account and
made customisable without a code change.

- **Env var name.** The key is read as `Brevo_API` (matching the Railway variable exactly), not the
  earlier `BREVO_API_KEY`. Unset ⇒ the email client is a logged no-op, so the API still boots and
  reminders/receipts simply don't send until it's configured.
- **Template-or-HTML per send.** `SendEmailInput` gained `templateId?` + `params?`. When a send
  supplies a `templateId`, the Brevo client posts `{ templateId, params }` and Brevo renders the
  template designed in the dashboard; otherwise it posts our built-in `htmlContent` fallback. So
  email copy/design is editable in Brevo with no deploy, and the HTML remains the safe default.
- **Sender.** `EMAIL_FROM_ADDRESS` must be a **verified** Brevo sender; it's required for the HTML
  fallbacks but optional when every email uses a template (a template carries its own sender). The
  provider warns (doesn't fail) when the key is set but the sender isn't.
- **Which template each send uses & its params** (set the env var to opt a given email into a Brevo
  template):
  - Reminder digest — `BREVO_REMINDER_TEMPLATE_ID`. Params: `name` (account name),
    `calendarUrl` (link to their calendar), `birthdays` (`[{ name, date }]` to loop over).
  - Guest receipt — `BREVO_GUEST_RECEIPT_TEMPLATE_ID`. Params: `claimUrl` (the account-claim link).
- **Still not verifiable from this sandbox:** real Brevo delivery (no network path to Brevo). Tests
  mock `EMAIL_CLIENT`; a live send needs `Brevo_API` + a verified `EMAIL_FROM_ADDRESS` in Railway.

**Branded email shell — landed.** Every outbound email now renders through one shared, email-safe
layout so the whole product speaks the same visual language.

- **One source of truth.** `apps/api/src/email/email-layout.ts` (`renderBrandedEmail`) wraps content
  in a table-based, inline-styled document with the Kudos logo, the app's brand palette (mirrored
  from `globals.css` — accent `#e5372a`), a bulletproof CTA button, a hidden preheader, and a
  consistent footer. The reminder digest and guest receipt were refactored onto it (replacing their
  divergent ad-hoc HTML, including an off-brand `#ef5b52` red). This shell is the HTML fallback; a
  configured Brevo template still supersedes it per email.
- **Supabase auth emails.** Signup confirmation, magic link, password reset, invite and email-change
  are sent by Supabase, not our API, so they can't be branded in code. They're **generated** from
  the same layout into `docs/email-templates/*.html` (via
  `apps/api/scripts/generate-auth-email-templates.mjs`) and installed by pasting into Supabase →
  Authentication → Email Templates (see that folder's `README.md`). Generated, never hand-edited, so
  they can't drift from the transactional emails.
- Tests assert both transactional emails carry the brand shell (footer + accent), so a future
  refactor can't silently un-brand them.

**Order confirmation for account holders — landed.** Previously only *guests* were emailed after a
paid order (the claim receipt); a signed-in account holder got nothing. The post-fulfilment send now
branches on whether the account is still a guest:

- **Guest** (has a claim token) → the existing claim receipt.
- **Account holder** (contact email, no claim token) → a branded order confirmation showing the
  order ref (`ORD-####`), card count and total paid, with a **View your order** CTA linking to
  `/orders/:id`. Opt into a Brevo template via `BREVO_ORDER_CONFIRMATION_TEMPLATE_ID`
  (params: `orderNumber`, `cardCount`, `total`, `orderUrl`).

Both still fire only on the first webhook delivery (`fulfilled === true`) and are best-effort. e2e
covers all three: an account holder gets exactly one confirmation (not the claim email), a guest
gets the claim receipt (not the confirmation), and neither re-sends on redelivery.

**Auth-email link fallback — landed.** The generated Supabase templates now render a plain
"button not working? paste this link" fallback under the CTA, so confirm/magic-link/reset still work
in clients that strip the button. `renderBrandedEmail` gained a `showLinkFallback` flag for this.

**Dispatch notification — landed.** When ops mark a card **posted** (the dispatched state in the
fulfilment state machine), the buyer now gets a branded "your card is on its way" email. Sent
**after** the transition transaction commits and **grouped by order**, so a bulk post-run sends one
email per order (listing the recipient names) rather than one per card. Fully best-effort — a send
failure is logged, never rolls back the (already committed) dispatch — and a no-op if the account
has no contact email. Opt into a Brevo template via `BREVO_DISPATCH_TEMPLATE_ID` (params:
`orderNumber`, `cardCount`, `recipientNames`, `orderUrl`). e2e covers it: posting a card emails the
buyer exactly once with the order ref + brand shell, and nothing is sent on the earlier `printed`
step. `escapeHtml` moved into `email-layout.ts` as a shared export (was duplicated in the reminder
service).

This gives the buyer a full lifecycle of branded email: **confirmation** at payment →
**dispatch** when the card is posted.

**Multi-card guest basket — API landed.** The guest journey grows from a single card to a
Moonpig-style basket: a visitor can buy and send several personalised cards in one payment, still
with no account.

- New `POST /guest/cart-checkout` (`@Public()`, same 10/min per-IP throttle as the single-card
  checkout — one call still mints one account + one Checkout Session whatever the basket size). Body:
  `{ buyerEmail, items: [{ cardDesignId, document?, recipient…, shipping…, postageClass?,
  occasionType? }] }`, 1–20 items.
- Reuses the **same money path**: a new `BatchOrdersService.quickSendMany` builds one draft
  `BatchOrder` across every card (each becomes an approved one-off occasion), sharing a private
  `buildQuickSendLine` helper with the single-card `quickSend` so the two can't drift. Pricing, the
  approved→queued transition, fulfilment and the webhook are all unchanged — a basket is just a
  batch order with N recipients. The single-card `GuestOrdersService.checkout` now delegates to
  `checkoutCart` with a one-item basket, so there is one implementation.
- The **whole basket is validated before any account is minted** (every card design must be a live
  catalogue template), so a bad basket 404s cleanly with no orphan guest account. The 20-item cap
  mirrors the free plan's `batchOrderMaxSize` (`GUEST_CART_MAX_ITEMS`), giving a clean 400 rather
  than a 403 deep in the money path.
- shared-types: `guestCartItemSchema` + `guestCartCheckoutInputSchema` (+ `GUEST_CART_MAX_ITEMS`).
- e2e: a 3-card basket makes one order/account with three distinct recipients each at the flat £1.50
  and a single Checkout Session; an invalid card mints no account; empty and over-cap baskets 400.

The web basket UI (public header with basket + reminders, cart state, `/basket` page) builds on this
endpoint in a follow-up.

**Multi-card guest basket — web landed.** The public site now gives one-off visitors a Moonpig-style
basket experience.

- **Shared public header** (`components/public-header.tsx`) across the home page and card library:
  browse nav, a **Reminders** prompt, a **Basket** with a live count badge, and Sign in. The old
  `CardsHeader` is now a thin alias so every public page picks it up. Marketing-styled (coral),
  independent of the app shell.
- **Reminders icon** — for a signed-out visitor it opens a small prompt ("Never miss a birthday —
  create a free account…") with Sign up / Sign in, since reminders need an account; a signed-in
  visitor is sent straight to `/calendar`.
- **Client cart** (`lib/cart.ts`) — a localStorage store exposed via `useSyncExternalStore`
  (`useCart` / `useCartCount`), cross-tab synced, capped at `CART_MAX_ITEMS` (20). Each item is a
  template card + one recipient + address.
- **Add to basket** — the guest card flow (`/cards/[id]/send`) now *adds to the basket* instead of
  checking out immediately; the buyer's email moves to the basket. **`/basket`** lists the cards
  (thumbnail, recipient, address, remove), shows the order summary, and pays for all of them in one
  go via `POST /guest/cart-checkout` → Stripe. `/basket` is a public path in the middleware.
- Verified by build + a rendered screenshot pass (header, reminders prompt, basket).

## Consequences

- One-off buyers convert with **zero signup friction**; the money path, webhook, and fulfilment are
  **reused unchanged**; and every guest purchase is a warm lead (contact already saved) for a
  personal account.
- The only genuinely new infrastructure is a transactional email sender for reminders — isolated to
  its own phase, gated on the provider decision.
- No change to business accounts; they proceed exactly as planned.
