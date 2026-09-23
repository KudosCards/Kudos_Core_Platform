import type {
  CardDesign,
  RecipientListSummary,
  SavedDesignListItem,
  StandingOrder,
} from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { ClickAndForgetClient } from "./click-and-forget-client";

/**
 * "Click and forget": set it up once, and Kudos sends the birthday cards.
 *
 * The customer-facing half of the standing order (ADR 0256) and the approval
 * run that reads it (ADR 0257). Readable on every plan — the feature is meant
 * to be seen and laid out before it is paid for, so the upgrade prompt lands on
 * somebody who has already chosen their cards. See docs/adr/0258 and 0262.
 */
export default async function ClickAndForgetPage() {
  const [order, designs, lists, templates] = await Promise.all([
    serverApiFetch<StandingOrder>("/standing-order").catch(() => null),
    serverApiFetch<SavedDesignListItem[]>("/saved-designs").catch(() => null),
    serverApiFetch<RecipientListSummary[]>("/recipient-lists").catch(() => null),
    // Birthday templates only. This page sends birthdays and nothing else, so
    // offering a "get well soon" card to add to the pool would be offering a
    // mistake. The category filter is the API's own, so a card is birthday here
    // exactly when the catalog says it is.
    serverApiFetch<CardDesign[]>("/card-designs?category=birthday").catch(() => null),
  ]);

  return (
    <ClickAndForgetClient
      initialOrder={order}
      designs={(designs ?? []).map((design) => ({
        id: design.id,
        name: design.name,
        document: design.document,
        category: design.category,
      }))}
      lists={(lists ?? []).map((list) => ({
        id: list.id,
        name: list.name,
        memberCount: list.memberCount,
      }))}
      templates={templates ?? []}
    />
  );
}
