import { notFound } from "next/navigation";
import type { Occasion, Recipient, RecipientKeyDate, ReturnCase } from "@kudos/shared-types";
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

  // The recipient, its events, and RTS cases don't depend on each other (all
  // keyed by the same id), so fetch them in one parallel round-trip instead of
  // three serial ones. The recipient's 404 becomes null → notFound(); the other
  // two are only wasted in that rare not-found case. See docs/adr/0042.
  const [recipient, events, allReturns, keyDates] = await Promise.all([
    serverApiFetch<Recipient>(`/recipients/${id}`).catch((error: unknown) => {
      // A wrong/foreign id is a 404 from the account-scoped lookup — render the
      // app's not-found rather than leaking the API error.
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    serverApiFetch<Paginated<Occasion>>(`/occasions?recipientId=${id}&perPage=100`),
    // Any Returned-to-Sender cases for this contact, so the recovery panel can
    // show the alert + Update-Address flow. Account-scoped; filtered to this one.
    serverApiFetch<ReturnCase[]>("/returns"),
    // The recipient's recurring key dates (renewal / anniversary). Best-effort:
    // an empty list just means none set. See docs/adr/0104.
    serverApiFetch<RecipientKeyDate[]>(`/recipients/${id}/key-dates`).catch(() => []),
  ]);

  if (!recipient) {
    notFound();
  }

  const returnCases = (allReturns ?? []).filter((c) => c.recipientId === id);

  return (
    <RecipientDetailClient
      recipient={recipient}
      initialEvents={events?.items ?? []}
      initialReturnCases={returnCases}
      initialKeyDates={keyDates ?? []}
    />
  );
}
