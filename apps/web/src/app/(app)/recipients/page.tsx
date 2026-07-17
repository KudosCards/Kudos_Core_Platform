import type { Recipient } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { RecipientsClient, PER_PAGE, type Paginated } from "./recipients-client";

export default async function RecipientsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  let result: Paginated<Recipient> | null = null;
  try {
    result = await serverApiFetch<Paginated<Recipient>>(
      `/recipients?page=${page}&perPage=${PER_PAGE}`,
    );
  } catch (error) {
    // TEMPORARY DIAGNOSTIC — surfaces the exact production error that Next.js
    // otherwise hides in prod builds. Remove once the recipients 500 is fixed.
    const detail = {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      status: error instanceof ApiError ? error.status : undefined,
      body: error instanceof ApiError ? error.body : undefined,
    };
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Recipients — diagnostic</h1>
        <pre className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-xs">
          {JSON.stringify(detail, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <RecipientsClient
      initialRecipients={result?.items ?? []}
      initialTotal={result?.total ?? 0}
      initialPage={page}
    />
  );
}
