import type { RecipientListSummary } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { NewSmartListClient } from "./new-smart-list-client";

/** Build a smart list from scratch. See docs/adr/0177. */
export default async function NewSmartListPage() {
  const lists = await serverApiFetch<RecipientListSummary[]>("/recipient-lists").catch(() => null);
  return <NewSmartListClient lists={lists ?? []} />;
}
