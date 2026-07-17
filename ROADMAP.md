# Kudos Cards — Product Roadmap

_Rebuild of the WordPress/WooCommerce platform as a web-first B2B SaaS. This is the
living plan: what's shipped, what's left, and the order we intend to build it. Tick items
off as they land._

Last updated: 2026-07-17

---

## The product, in one paragraph

A tuition centre (or club/business) signs up, uploads its contacts (CSV now, CRM
integrations later), and those contacts populate a **calendar** of milestone moments
(birthdays and other occasions). For each moment the customer picks a professionally
designed card, personalises it, and places an order — increasingly **automated**. Every
paid order lands at **Kudos HQ**, where we print and post it. The goal is bulk,
personalised, largely hands-off card-sending across the year. Public web traffic lands on
a **marketing site** that sells the membership tiers and funnels visitors into signup.

Customer journey:
**land on marketing site → sign up / log in → upload contacts → calendar of moments →
personalise per contact & occasion → order (manual or automated) → Kudos HQ prints & posts.**

---

## Status at a glance

The **transactional spine is built and live in production** — the hard, foundational 65–70%.
The remaining work is mostly customer-facing surface and automation that sits on top of it.

| Journey step | Status |
|---|---|
| Marketing homepage (sell membership, how-it-works) | ❌ Not built |
| Register / log in | ✅ Built (email + password) |
| Upload CSV of contacts / manage contacts | ✅ Built |
| Contacts → a **calendar** of moments | ⚠️ Data + scheduling only, **no calendar UI** |
| Milestone moments per contact, choose occasion | ✅ Built |
| Personalise cards (catalog + editor + `{name}`) | ✅ Built |
| Bulk multi-card order, per-recipient addresses | ✅ Built |
| Pay | ⚠️ Card only (**no wallet**) |
| Orders → Kudos HQ → print & post | ✅ Built (ops queue) |
| Automation / auto-send | ⚠️ Partial (scheduling yes; auto-order/charge/dispatch no) |
| Subscription tiers | ✅ Built (Stripe) |

Two capabilities exceed the old platform: **QR-linked digital message pages** and a proper
internal **fulfilment ops queue**.

---

## Shipped (Phases 0–5 + catalog)

- **Phase 0 — Foundations:** Turborepo monorepo (NestJS API, Next.js web, shared Zod types),
  Prisma/Postgres schema, CI, ADRs.
- **Phase 1 — Accounts & contacts:** Supabase JWT auth (JWKS/ES256), accounts, recipients
  CRUD, CSV import (dedupe on name + postcode + DOB), plan caps.
- **Phase 2 — Design & occasions:** card catalog + canvas (Konva) editor with `{name}` merge
  tokens, saved designs, occasions engine, birthday auto-scheduling (cron), approvals queue.
- **Phase 3 — Orders & billing:** batch orders (per-recipient shipping, dispatch/postage
  options), Stripe Checkout, webhooks, subscriptions, billing page.
- **Phase 4 — Message pages:** QR-linked personalised card pages (`/r/[slug]`).
- **Phase 5 — Fulfilment ops:** cross-account ops queue + state machine, platform-admin
  guard, GDPR-minimised addresses with audited export.
- **Catalog integration:** live Airtable → catalog sync (artwork copied to storage,
  self-healing, concurrent), ops "Refresh catalog", Designs category filter.

---

## Open decisions (needed before / during the money-path work)

1. **Pricing model — CONFIRMED CHANGE.** Postage is charged **per card, on top of the card
   price** (5 cards = 5 stamps), plus VAT — _not_ the flat postage-inclusive £1.50 the code
   currently assumes. This must be corrected before wallet/auto-send. Still to pin down:
   - Exact per-card postage for 1st vs 2nd class (screenshots suggest ≈ £1.80 / £0.91 — confirm).
   - VAT treatment (which components are standard-rated vs zero/exempt; is displayed total
     VAT-inclusive?).
2. **Marketing site hosting.** New Next.js public route group vs a separate CMS. Recommendation:
   build it as public pages in this app so signup/checkout flow is seamless and version-controlled.
3. **Auto-send funding.** Wallet balance and/or saved card (Stripe off-session). Recommendation:
   wallet first (already schema-scaffolded), saved-card later.

---

## Remaining work (proposed phases)

### Phase 6 — Pricing correction (money-path) — _do first_
Postage becomes a **per-card** line item on top of card price, with VAT handled correctly.
Touches batch-order pricing, checkout totals, order records, and every downstream total.
Foundational: wallet and auto-send depend on correct maths.

### Phase 7 — Calendar UI
The missing centrepiece of the journey. Monthly / weekly / list views of each contact's
moments (birthdays + custom occasions), a dispatch-date toggle, filter by occasion type, and
**"create order from the calendar."** API/data already exist (occasions + dispatch dates).

### Phase 8 — Wallet
Balance, top-up (Stripe), ledger, and **wallet-as-payment** at checkout. Schema is already
scaffolded (`WalletLedgerEntry`, `paymentMethod` enum). Also the funding source that makes
automation friction-free.

### Phase 9 — Auto-send automation
The "as automated as we can make it" promise, end-to-end: for an upcoming occasion,
auto-create the order, charge wallet/saved card, and **time dispatch to arrive before the
date** (1st class ~3 days before, 2nd ~5). A Pro/Centre entitlement (`autoSendEnabled` exists).
Builds on the existing scheduler + Phase 6 pricing + Phase 8 wallet.

### Phase 10 — Account & orders experience
Customer **order history** (list, status, pay-pending, view), address book, saved payment
methods, and a richer dashboard (order counts, birthdays-this-month, notes scratchpad).

### Phase 11 — Marketing homepage & public site
Glossy landing that sells the membership: hero, how-it-works, plan comparison, social proof,
clear CTAs into **sign up / log in**. Wires plan selection into the existing Stripe
subscription checkout. Can be built partly in parallel with 6–10.

### Later / backlog
- CRM integrations (import beyond CSV).
- Coupons / discount codes, order notes at checkout.
- Mobile-number login (WP allows email _or_ mobile).
- "Signal List" (monitor contacts for key moments) and "Come Back Cards" (re-engage lapsed) —
  these were _"coming soon"_ even on the WordPress site.
- Public card **shop** browse (buy an individual card outside the workspace flow).

---

## Rough completion

- **Foundational platform (the expensive part): ~65–70% and done.**
- **Remaining ~30–35%** is customer-experience surface + automation + marketing — high
  visibility, but layered on top of a proven spine. Risk is low; momentum is high.

Recommended next build: **Phase 6 (pricing correction)** — it's a correctness fix everything
downstream depends on — then **Phase 7 (Calendar)** as the next visible win, with **Phase 11
(marketing homepage)** buildable in parallel whenever go-to-market needs it.
