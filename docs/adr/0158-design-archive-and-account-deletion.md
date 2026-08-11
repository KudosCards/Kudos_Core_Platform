# 0158 — Design soft-delete (archive) and self-serve account deletion

## Status

Accepted — implemented.

## Context

Two pieces of user feedback:

1. **Deleting a saved design showed a misleading, dead-end error.** "This design
   is attached to an approved occasion and can't be deleted" fired even when the
   user could see no such occasion. A `SavedDesign` is referenced by both
   `Occasion.savedDesignId` (Restrict) **and** `OrderRecipient.savedDesignId`
   (required) — so any design ever used in an order, however old, hit the same
   raw FK error, and the message only guessed at one cause. Worse, order history
   is immutable, so such a design could **never** be deleted — the user was
   permanently stuck with clutter and a confusing message.

2. **There was no way to delete an account.** No self-serve closure/erasure path
   existed in settings.

## Decisions

### 1. "Delete design" archives when it can't hard-delete

Added `SavedDesign.archivedAt` (nullable). `remove()` now tries a hard delete;
on the FK-violation it **archives** instead (sets `archivedAt`) and reports which
happened via `{ archived: boolean }`. The gallery, `findOne`, and `update` all
filter to `archivedAt IS NULL`, so an archived design leaves "My designs" and the
API entirely while the row stays intact for the order/occasion history that
references it. The web gallery removes the tile either way and shows a plain
notice ("removed from your library — kept on the past orders that used it" vs
"deleted"), never the old red error. Delete now always succeeds from the user's
point of view.

### 2. Owner-only, self-serve account deletion (settings "Danger zone")

`DELETE /accounts/me` (MembershipGuard), gated and sequenced for safety:

1. **Owner-only** (`membership.role === "owner"`) + a **typed-name confirmation**
   (`confirmName` must equal the account name) — no accidental fires. The web UI
   shows the danger zone only to owners (via `/team`'s `yourRole`) behind an
   explicit expand.
2. **In-flight guard:** blocks with a 409 while any card is `queued`/`printed`/
   `posted` — paid physical mail must not be silently stranded. Delivered/
   cancelled/returned lines don't block.
3. **Cancel billing first:** cancels every live Stripe subscription
   (`active`/`trialing`/`past_due`) before touching data, and **aborts** (503) if
   Stripe errors — we never delete an account we might keep charging. A
   subscription already gone on Stripe's side is tolerated.
4. **Ordered cascade delete:** batch orders (cascades order lines) → occasions →
   `account.delete()`. This clears the two Restrict FKs into `SavedDesign` before
   the account row cascades the rest (recipients, designs, wallet, subscriptions,
   notifications, support, …).
5. **Remove logins:** deletes each membership's Supabase auth user (best-effort —
   the data is already gone, and a login with no membership is locked out by
   MembershipGuard regardless). The web client signs out and redirects to /login.

`AccountsModule` now imports `BillingModule` (for `STRIPE_CLIENT`) and provides
the service-role `supabaseAdminProvider`.

## Consequences

- Users can always remove a design from their library; history stays intact.
- Owners can close their own account without contacting support; billing stops
  and personal data is erased (GDPR-aligned), with a guard against destroying
  paid in-flight mail.
- Deletion is irreversible by design; the typed confirmation + owner gate are the
  safety net. Schema change is additive (`archived_at`); no data migration for
  existing rows.
