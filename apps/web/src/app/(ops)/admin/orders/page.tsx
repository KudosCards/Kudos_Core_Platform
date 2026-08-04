import type { BatchOrderStatus } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { AdminOrdersClient, type AdminOrderRow } from "./orders-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

const VALID_STATUSES: BatchOrderStatus[] = [
  "paid",
  "fulfilling",
  "completed",
  "pending_payment",
  "cancelled",
  "draft",
];

const PER_PAGE = 25;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; page?: string }>;
}) {
  const { status: statusParam, search: searchParam, page: pageParam } = await searchParams;
  const status = VALID_STATUSES.includes(statusParam as BatchOrderStatus)
    ? (statusParam as BatchOrderStatus)
    : undefined;
  const search = searchParam?.trim() ?? "";
  const page = Math.max(1, Number(pageParam) || 1);

  // Search, status filter and pagination are resolved server-side (see
  // admin.listOrders) — the list is no longer capped at the newest 100 orders.
  const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
  if (status) params.set("status", status);
  if (search) params.set("search", search);

  const result = await serverApiFetch<Paginated<AdminOrderRow>>(`/admin/orders?${params.toString()}`);

  return (
    <AdminOrdersClient
      initialOrders={result?.items ?? []}
      total={result?.total ?? 0}
      page={result?.page ?? page}
      perPage={result?.perPage ?? PER_PAGE}
      status={status ?? "all"}
      search={search}
    />
  );
}
