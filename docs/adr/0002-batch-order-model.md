# ADR 0002 — Batch orders are one order with many recipient lines

Status: accepted
Date: 2026-07-15

## Context

Walking through the legacy WooCommerce-based system (see the platform architecture plan, §2),
ordering cards for 10 recipients creates 10 near-identical WooCommerce cart line items, each
needing its own recipient re-selected again at checkout. That's real, observed friction — and
the brief explicitly asks for "enhanced UX" and "faster feature development."

## Decision

Model a batch send as **one `BatchOrder`** with **many `OrderRecipient` lines**, each carrying
its own recipient, design, shipping address, dispatch timing, and status — instead of one
commerce line item per recipient. See `apps/api/prisma/schema.prisma`.

## Alternatives considered

- **Keep the cart-line-per-recipient pattern** (simplest port of the legacy behaviour) —
  rejected: it reproduces the exact friction the rebuild is meant to fix, and it means "was this
  batch fully sent" has no single answer, only N independent line items to check.

## Consequences

- A single `BatchOrder.status` gives a clear answer to "is this batch done," while
  `OrderRecipient.status` still tracks each card's individual fulfilment progress.
- Checkout UX can present "10 recipients, one order" instead of 10 near-identical cart rows.
- Partial failure (9 of 10 cards print, 1 fails) is representable per-line without needing to
  split or duplicate the parent order.
