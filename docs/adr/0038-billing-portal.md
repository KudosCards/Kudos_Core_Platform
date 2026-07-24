# ADR 0038 — Self-service billing portal (invoices, receipts, card, cancellation)

Status: accepted
Date: 2026-07-24

## Context

Customers pay us — subscriptions (Pro/Centre), extra seats, card orders, wallet top-ups — but had
no way to **get their invoices and receipts**, update the card on file, or cancel a subscription
themselves. Every one of those was a support email. For a B2B SaaS selling to tuition centres, "I
need a VAT invoice for my records" is a routine, recurring ask; it should be self-service.

Stripe already hosts a **Customer Portal** that does exactly this — invoice/receipt history with PDF
download, payment-method updates, and cancellation — on Stripe's own pages. We store no card data
and build no billing UI. The only real decision is how to make it work **without** the one-time
manual "activate the portal" step in the Stripe Dashboard.

## Decision

### Provision the portal configuration from the running app

The portal needs a **configuration** (which features to show). Relying on the account's *default*
configuration means someone has to click "Save" in the Dashboard once, or the very first
`billingPortal.sessions.create` fails with "no configuration provided." Instead
`BillingPortalService.ensurePortalConfigurationId()` **creates a configuration over the API** on
first use and stores its id in the `PlatformSetting` table — the same "provision from the running
app, no dashboard step" pattern used for the seat price (ADR 0037). Resolution order mirrors the
seat price: `STRIPE_BILLING_PORTAL_CONFIG_ID` env override → stored id → create-and-store. So the
portal works from a fresh deploy, and an operator can still pin a Dashboard-built configuration by
setting the env var.

The configuration enables: **invoice history** (the point of the feature), **payment-method
update**, **customer update** (email/address/name/tax id — so a centre can add its VAT id to its
invoices), and **cancellation at period end** (they keep what they've paid for until it runs out —
no mid-cycle loss, matching how we bill).

### One customer mapping, shared

Both subscription checkout and the portal need the account's Stripe Customer. The race-safe
"create once then reuse" logic that lived privately in `SubscriptionsService` is now a shared
`StripeCustomerService.getOrCreate(accountId)` in the billing module, so there's exactly one place
that maps an account to a Customer and the invariant can't drift between call sites.

### API

`POST /subscriptions/portal` (MembershipGuard) → `{ url }`. **Any member** may open it; Stripe
scopes the portal to the account's own Customer, so there's nothing cross-account to leak, and a
staff member fetching their centre's own receipts is expected. Opening the portal is audit-logged
(`billing_portal_opened`). A brand-new account with no purchases still gets a valid (empty) portal —
the Customer is created on demand — rather than an error.

### Web

The `/billing` page gains an **"Invoices & receipts → Manage billing"** card that POSTs to the
endpoint and redirects the browser to the returned Stripe URL; the portal returns the user to
`/billing` when they're done.

## Alternatives considered

- **Build our own invoice/receipt UI** — rejected: we'd be re-rendering data Stripe already renders
  (with compliant PDF invoices), for no benefit and real VAT-formatting risk.
- **Require the Dashboard "activate portal" step** — rejected for the same reason ADR 0037 rejected
  Dashboard-only price creation: the running app can provision it itself, so nothing blocks on a
  human clicking through Stripe's settings.
- **Restrict the portal to owners/admins** — unnecessary; Stripe already scopes it to the one
  Customer, and downloading your own organisation's receipts isn't a privileged action. Cancellation
  is the only mutating feature, and it's period-end (reversible in-app before it takes effect).

## Consequences

- Customers self-serve invoices, receipts, card updates, and cancellation — support load drops and
  VAT-invoice requests stop being manual.
- No card data touches us; no billing UI to maintain beyond one button.
- The portal configuration and the account→Customer mapping are both provisioned/held by the running
  API, so this ships with **no Stripe Dashboard step** and no new required env var.
- `StripeCustomerService` is now the single owner of Customer creation, removing the duplicated
  race-safe logic from `SubscriptionsService`.
