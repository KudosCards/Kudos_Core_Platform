import type { Recipient } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { RecipientsClient } from "./recipients-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export default async function RecipientsPage() {
  const result = await serverApiFetch<Paginated<Recipient>>("/recipients?perPage=100");

  return (
    <RecipientsClient
      initialRecipients={result?.items ?? []}
      initialTotal={result?.total ?? 0}
    />
  );
}
