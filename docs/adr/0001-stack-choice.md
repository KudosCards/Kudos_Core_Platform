# ADR 0001 — TypeScript everywhere, NestJS API + Next.js web, Supabase as managed infrastructure

Status: accepted
Date: 2026-07-15

## Context

Kudos Cards is rebuilding off WordPress/WooCommerce into a web-first platform with its own API,
ahead of a later native-app phase. The team already operates GitHub, Supabase, Netlify, Vercel,
Railway, and Airtable day to day, and the explicit ask is "highest standards" — built for
longevity and scale, not just a quick MVP patch.

## Decision

- **Language**: TypeScript across the whole stack (API, web, shared packages).
- **API**: NestJS, deployed to Railway. The API is the sole source of business logic and the
  only writer to the database — the frontend never talks to Supabase directly for business data.
- **Web**: Next.js (App Router), deployed to Vercel. One codebase serves the SEO-critical
  marketing site, the authenticated app ("Workspace"), and the public QR message pages.
- **Database/Auth/Storage**: Supabase — treated purely as managed infrastructure (Postgres via
  Prisma, Auth as the JWT issuer, Storage for uploads), not as an application layer.
- **Shared types**: a `packages/shared-types` package of Zod schemas, consumed by both API DTOs
  and frontend code, so the two can't silently drift apart.

## Alternatives considered

- **Python (FastAPI/Django) or Ruby on Rails** for the API — both are credible, and Django's
  admin in particular would have been a fast way to get an internal ops screen. Rejected in
  favour of one language end-to-end, which pairs naturally with a TypeScript frontend and keeps
  the shared-types package meaningful (it can't exist across a language boundary).
- **Using Supabase directly from the frontend** (its auto-generated REST/GraphQL layer, with
  Row Level Security as the only access control) — faster to bootstrap, but it means business
  logic (entitlement checks, the occasion scheduler, billing rules) either lives in Postgres
  functions/RLS policies or leaks into the frontend. Explicitly rejected: the brief asks for "its
  own API," and centralising logic in NestJS is what makes a future native app, or a future
  admin tool, a straightforward client of the same API rather than a re-implementation.
- **AWS full-control infrastructure (ECS/RDS/Terraform)** — more control, but real ongoing DevOps
  overhead the team doesn't currently carry. Deferred, not rejected: nothing here blocks a later
  migration off Railway/Vercel/Supabase if scale demands it, because the API and web app don't
  depend on anything Railway/Vercel-specific.

## Consequences

- Onboarding a new engineer only requires TypeScript, not a second language.
- The API can be pointed at any Postgres instance later (e.g. self-hosted, AWS RDS) without a
  rewrite — Supabase is a swappable implementation detail behind Prisma.
- We take on the discipline cost of keeping `packages/shared-types` and
  `apps/api/prisma/schema.prisma` enums in sync by hand (Prisma can't import from TypeScript);
  documented as a standing rule, not solved automatically.
