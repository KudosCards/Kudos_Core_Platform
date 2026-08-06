# 0126 — Automatic payment methods at checkout (Apple Pay / Google Pay / Link) + pay-confirmed fulfilment

## Status

Accepted

## Context

A test buyer reported being unable to pay with **Apple Pay on desktop**. Investigation of the payment integration:

- Every payment flow — card orders (`BatchOrdersService.checkout`), guest orders (which reuse it), and wallet top-ups (`WalletService.createTopUpCheckout`) — creates a **Stripe-hosted Checkout Session** and redirects the browser to `checkout.stripe.com`. The web app embeds **no** Stripe Elements / Express Checkout anywhere.
- Two of those flows pinned `payment_method_types: ["card"]`.

Two facts follow. First, because checkout is **Stripe-hosted**, Apple Pay needs **no domain registration** on our side (the `.well-known` association file is only required for Elements/Express Checkout on your own domain; `checkout.stripe.com` is pre-registered). Second, `payment_method_types: ["card"]` does **not** disable Apple Pay — the wallets ride on the `card` method — so the code was not the blocker. Apple Pay on **desktop** renders only in **Safari on macOS** with a card in Wallet; a non-Safari desktop browser never shows it. That platform constraint is the most likely explanation for the report.

Even so, the hardcoded `["card"]` list opts out of Dashboard-managed **automatic payment methods**, so wallets and Link aren't presented as first-class, and enabling a new method would require a code change. The natural improvement — letting Stripe present every enabled method — surfaces a latent risk: the webhook fulfilled an order (and credited a wallet) on `checkout.session.completed` **without checking `payment_status`**, and didn't handle the async-payment events. That's safe for card and the wallets (all settle synchronously as `paid`), but a **delayed-notification** method would complete the session `unpaid` and be fulfilled before the money cleared.

## Decision

Two coupled changes:

### 1. Offer every enabled payment method

The card-order and wallet-top-up sessions now **omit `payment_method_types`** (previously `["card"]`). On a Stripe-hosted Checkout Session, omitting it is what enables Dashboard-managed automatic payment methods — Stripe presents whatever is enabled in the Dashboard (card plus the **Apple Pay / Google Pay / Link** wallets today), and new methods can be turned on from the Dashboard with no code change. (`automatic_payment_methods` is a PaymentIntent parameter, not a Checkout Session one; the Checkout equivalent is simply not pinning the list. The subscription session already relied on this.)

### 2. Only settle a *paid* session

`WebhooksService` now:

- **Guards on `payment_status === "paid"`** at the top of the checkout-session handler. A synchronous method (card/wallets/Link) arrives `paid` and settles immediately; a delayed method arrives `unpaid` on `completed` and is skipped.
- **Handles `checkout.session.async_payment_succeeded`** through the same settle path (it re-enters `paid`), so a delayed payment fulfils/credits once it clears.
- **Handles `checkout.session.async_payment_failed`** by releasing a stranded order back to `draft` (mirroring an expired session); a wallet top-up is credited only on success, so a failed top-up needs no undo.

Together these make it safe to offer any Dashboard-enabled method without ever fulfilling an order or crediting a wallet before payment is confirmed.

## Consequences

- Apple Pay / Google Pay / Link are now first-class at checkout (subject to the buyer's browser — Apple Pay still needs Safari on Apple hardware).
- Fulfilment and wallet credit are now strictly gated on confirmed payment, closing a fulfil-before-paid gap that would have opened if a delayed method were ever enabled.
- **Operational note (not code):** confirm **Apple Pay is enabled** in the *live* Stripe Dashboard (Settings → Payments → Payment methods) and that the reporting tester used **Safari on a Mac** with a Wallet card. This is where the original report most likely originates.
- Tests: webhook e2e now covers completed-but-unpaid (no fulfilment), `async_payment_succeeded` (fulfils), and `async_payment_failed` (releases to draft); wallet e2e covers unpaid-top-up (no credit). The shared test event builders default `payment_status: "paid"` for settle events so existing card fixtures are unchanged.
