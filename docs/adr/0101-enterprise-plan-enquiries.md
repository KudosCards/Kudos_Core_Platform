# 0101 — Enterprise plan: a "Contact us" tier + lead capture

## Status

Accepted

## Context

The three self-serve plans (Free / Pro / Centre, ADR 0100) top out at "unlimited
contacts + 3 seats". Larger prospects — multi-site groups, franchises, thousands
of contacts — need bespoke pricing and setup that doesn't fit a fixed monthly
price or a self-serve Stripe checkout. There was no way to present that, and no
way to capture such a lead.

## Decision

Add an **Enterprise** tier presented as "Contact us", with the enquiry captured,
emailed to ops, and worked from the admin portal.

1. **Enterprise is display-only + lead capture, not a self-serve plan.** It has
   no Stripe price, no card discount and no checkout. It's modelled *outside*
   `PLAN_CATALOG` as a separate `ENTERPRISE_PLAN` constant, so the checkout,
   billing-upgrade and price-guard code keep iterating only the three real plans.
   `planDisplayName` still resolves `"enterprise"` (ops can set an account to it
   by hand after a deal), so it names correctly wherever a plan appears.

2. **A persisted lead + email nudge + ops queue** (the delivery the user chose).
   A new `EnterpriseEnquiry` model stores each submission so a sales lead is
   never lost; on submit the API best-effort emails the ops inbox
   (`SUPPORT_INBOX_EMAIL`, reusing the branded-email infra) and ops work the lead
   from an admin queue with a `new → in_progress → closed` triage. The email is
   best-effort — a missing inbox address just means no nudge; the lead is safely
   stored either way.

3. **A public, throttled submit endpoint.** `POST /enterprise-enquiries` is
   `@Public()` (unauthenticated, like the RTS and guest routes) and rate-limited
   (5/min), validated by `CreateEnterpriseEnquiryDto` mirroring the shared
   `createEnterpriseEnquirySchema`. It returns only an acknowledgement (id +
   status), never the stored row. The ops side (`GET`/`PATCH
   /admin/enterprise-enquiries`) sits behind `PlatformAdminGuard`.

4. **A dedicated `/enterprise` page** (the placement the user chose) — a public,
   marketing-styled page reachable from the Enterprise option on both pricing
   tables. The contact form validates client-side with the shared zod schema,
   posts via `publicApiPost`, and shows a thank-you state. Enterprise appears as
   a distinct strip below the three-plan grid on the landing page and the billing
   page (a "Custom pricing → Contact us" call-out, not a fourth checkout column),
   keeping the self-serve grid clean.

## Consequences

- Large prospects have a clear path (Enterprise → Contact us → a real form), and
  every enquiry is stored and surfaced to ops with an email nudge — no lead lost.
- Because Enterprise lives outside `PLAN_CATALOG`, none of the money-path code
  (checkout, subscription upgrade, per-card price guard test) has to special-case
  a non-purchasable plan; it's purely presentational plus a lead pipe.
- One additive model + migration (`enterprise_enquiries`), a small API module
  (public + ops controllers), and web surfaces. Provisioning an Enterprise
  account is a manual ops step for now — deliberately, since pricing is bespoke.
- The public endpoint is unauthenticated, so it's throttled and length-bounded;
  it stores only what the form collects (no account relation, no PII beyond the
  contact details the enquirer provides).
