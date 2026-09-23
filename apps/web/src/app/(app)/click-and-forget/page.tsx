import type {
  CardDesign,
  ContactReadiness,
  RecipientListSummary,
  SavedDesignListItem,
  StandingOrder,
  WalletSummary,
} from "@kudos/shared-types";
import { walletProjectionSchema } from "@kudos/shared-types";
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
  const [order, designs, lists, templates, wallet, rawProjection] = await Promise.all([
    serverApiFetch<StandingOrder>("/standing-order").catch(() => null),
    serverApiFetch<SavedDesignListItem[]>("/saved-designs").catch(() => null),
    serverApiFetch<RecipientListSummary[]>("/recipient-lists").catch(() => null),
    // Birthday templates only. This page sends birthdays and nothing else, so
    // offering a "get well soon" card to add to the pool would be offering a
    // mistake. The category filter is the API's own, so a card is birthday here
    // exactly when the catalog says it is.
    serverApiFetch<CardDesign[]>("/card-designs?category=birthday").catch(() => null),
    // The money, beside the promise that spends it. Each is allowed to fail on
    // its own: a page that cannot price the next month is still a page somebody
    // can choose their cards on.
    serverApiFetch<WalletSummary>("/wallet").catch(() => null),
    serverApiFetch<unknown>("/wallet/projection").catch(() => null),
  ]);

  // `apiFetch` casts, it does not parse: every date in a response is a string
  // at runtime however the type reads. The projection is the one payload here
  // whose date gets formatted, so it is parsed with the schema that declares it
  // — `z.coerce.date()` turns the string into the Date the component is typed
  // for, and a response we cannot parse shows no money section rather than
  // throwing inside the render.
  const projection = walletProjectionSchema.safeParse(rawProjection);

  // Second, because it depends on the first: the coverage shown on arrival is
  // for the audience already saved, not for "everybody". A page that opens
  // showing the wrong number and corrects itself is a page that taught somebody
  // not to trust the number.
  const savedListId = order?.audience.kind === "list" ? order.audience.listId : null;
  const readiness = await serverApiFetch<ContactReadiness>(
    savedListId ? `/recipients/readiness?listId=${savedListId}` : "/recipients/readiness",
  ).catch(() => null);

  return (
    <ClickAndForgetClient
      // Null means the read failed. An account that has never set this up gets
      // a real empty instruction back (id: null), so the two are different
      // facts — and the page must not offer to overwrite an instruction it
      // could not read.
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
      wallet={wallet}
      projection={projection.success ? projection.data : null}
      initialReadiness={readiness}
    />
  );
}
