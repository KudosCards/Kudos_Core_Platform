import type { Recipient, RecipientListSummary } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { RecipientsClient, PER_PAGE, type Paginated } from "./recipients-client";

export default async function RecipientsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [result, lists] = await Promise.all([
    serverApiFetch<Paginated<Recipient>>(`/recipients?page=${page}&perPage=${PER_PAGE}`),
    serverApiFetch<RecipientListSummary[]>("/recipient-lists"),
  ]);

  return (
    <RecipientsClient
      initialRecipients={result?.items ?? []}
      initialTotal={result?.total ?? 0}
      initialPage={page}
      initialLists={lists ?? []}
    />
  );
}
