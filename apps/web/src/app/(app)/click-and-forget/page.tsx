import type { RecipientListSummary, SavedDesign, StandingOrder } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { ClickAndForgetClient } from "./click-and-forget-client";

/**
 * "Click and forget": set it up once, and Kudos sends the birthday cards.
 *
 * The customer-facing half of the standing order (ADR 0256) and the approval
 * run that reads it (ADR 0257). Readable on every plan — the feature is meant
 * to be seen and laid out before it is paid for, so the upgrade prompt lands on
 * somebody who has already chosen their cards. See docs/adr/0258.
 */
export default async function ClickAndForgetPage() {
  const [order, designs, lists] = await Promise.all([
    serverApiFetch<StandingOrder>("/standing-order").catch(() => null),
    serverApiFetch<SavedDesign[]>("/saved-designs").catch(() => null),
    serverApiFetch<RecipientListSummary[]>("/recipient-lists").catch(() => null),
  ]);

  return (
    <ClickAndForgetClient
      initialOrder={order}
      designs={(designs ?? []).map((design) => ({ id: design.id, name: design.name }))}
      lists={(lists ?? []).map((list) => ({
        id: list.id,
        name: list.name,
        memberCount: list.memberCount,
      }))}
    />
  );
}
