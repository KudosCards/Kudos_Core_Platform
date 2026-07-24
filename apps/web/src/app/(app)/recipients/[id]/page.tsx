import { notFound } from "next/navigation";
import type { Occasion, Recipient, ReturnCase } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { ApiError } from "@/lib/api";
import { RecipientDetailClient } from "./recipient-detail-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export default async function RecipientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let recipient: Recipient | null;
  try {
    recipient = await serverApiFetch<Recipient>(`/recipients/${id}`);
  } catch (error) {
    // A wrong/foreign id is a 404 from the account-scoped lookup — render the
    // app's not-found rather than leaking the API error.
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }
  if (!recipient) {
    notFound();
  }

  const events = await serverApiFetch<Paginated<Occasion>>(
    `/occasions?recipientId=${id}&perPage=100`,
  );

  // Any Returned-to-Sender cases for this contact, so the recovery panel can
  // show the alert + Update-Address flow. Account-scoped; filtered to this one.
  const allReturns = (await serverApiFetch<ReturnCase[]>("/returns")) ?? [];
  const returnCases = allReturns.filter((c) => c.recipientId === id);

  return (
    <RecipientDetailClient
      recipient={recipient}
      initialEvents={events?.items ?? []}
      initialReturnCases={returnCases}
    />
  );
}
