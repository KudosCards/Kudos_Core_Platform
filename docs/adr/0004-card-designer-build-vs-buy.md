# ADR 0004 — Build the card designer in-house rather than buying a white-label SDK

Status: accepted
Date: 2026-07-15

## Context

The legacy system's card designer is a real canvas-based tool: front/inside pages, a text tool
supporting `{name}` merge tokens, image uploads, a graphics library, and saved reusable designs.
This is genuine engineering scope (weeks, not days), so it needed an explicit decision rather
than being assumed.

## Decision

Build the card designer in-house as a canvas editor (Fabric.js or Konva + React), storing output
as portable design JSON (`packages/shared-types/src/card.ts`) rather than a flattened image, so
designs remain re-editable and support per-recipient token substitution across a batch order.

## Alternatives considered

- **Integrate a white-label print-personalisation SDK** (a Zakeke-style vendor) — would move
  faster initially, at the cost of a recurring per-design/per-render vendor fee and UX we don't
  fully control. Rejected: personalisation quality is the product's stated differentiator (per
  the Executive Summary's own thesis — recognition drives retention), and the fee model works
  against the 3–5 year target of "thousands of organisations." Paying a vendor per design at
  that scale is a materially worse economic outcome than owning this layer.

## Consequences

- Real, dedicated scope in the roadmap (Phase 2) rather than a checkbox — sized accordingly.
- Design JSON is portable: it can be re-rendered server-side to a print-ready PDF/image at
  fulfilment time, and re-opened for editing, without any vendor lock-in.
- We own the personalisation UX end to end, which is the basis for differentiating against any
  competitor who's just reselling a generic card-printing API.
