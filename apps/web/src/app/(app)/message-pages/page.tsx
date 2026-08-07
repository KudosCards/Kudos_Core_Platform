import type {
  MessagePageAccountInsights,
  MessagePageSummary,
  PlanEntitlement,
} from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { LibraryClient } from "./library-client";

/**
 * The Message Pages library (ADR 0132) — the account's reusable/bespoke digital
 * pages. Authoring is a paid-plan feature; reads stay open, so a downgraded
 * account still sees its pages while the "New page" action becomes an upsell.
 */
export default async function MessagePagesPage() {
  const [pages, entitlement, insights] = await Promise.all([
    serverApiFetch<MessagePageSummary[]>("/message-pages"),
    serverApiFetch<PlanEntitlement>("/accounts/me/entitlements"),
    serverApiFetch<MessagePageAccountInsights>("/message-pages/insights"),
  ]);
  return (
    <LibraryClient
      initialPages={pages ?? []}
      canAuthor={entitlement?.messagePagesEnabled ?? false}
      insights={insights}
    />
  );
}
