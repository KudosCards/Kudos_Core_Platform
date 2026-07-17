import type { Recipient } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { RecipientsClient, PER_PAGE, type Paginated } from "./recipients-client";

export default async function RecipientsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const result = await serverApiFetch<Paginated<Recipient>>(
    `/recipients?page=${page}&perPage=${PER_PAGE}`,
  );

  return (
    <RecipientsClient
      initialRecipients={result?.items ?? []}
      initialTotal={result?.total ?? 0}
      initialPage={page}
    />
  );
}
