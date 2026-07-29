import type { Recipient, RecipientListSummary } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { RecipientsClient, PER_PAGE, type Paginated } from "./recipients-client";

export default async function RecipientsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; missingAddress?: string }>;
}) {
  const { page: pageParam, missingAddress } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  // The dashboard "needs address" nudge lands here with ?missingAddress=true so
  // the worklist opens pre-filtered.
  const missingOnly = missingAddress === "true";

  const query = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
  if (missingOnly) query.set("missingAddress", "true");

  const [result, lists] = await Promise.all([
    serverApiFetch<Paginated<Recipient>>(`/recipients?${query.toString()}`),
    serverApiFetch<RecipientListSummary[]>("/recipient-lists"),
  ]);

  return (
    <RecipientsClient
      initialRecipients={result?.items ?? []}
      initialTotal={result?.total ?? 0}
      initialPage={page}
      initialLists={lists ?? []}
      initialMissingOnly={missingOnly}
    />
  );
}
