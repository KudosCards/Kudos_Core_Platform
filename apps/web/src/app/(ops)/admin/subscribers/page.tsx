import { serverApiFetch } from "@/lib/api.server";
import { AdminSubscribersClient, type AdminSubscriberRow } from "./subscribers-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

const VALID_HEALTH = ["active", "at_risk", "churned"] as const;
const PER_PAGE = 25;

export default async function AdminSubscribersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; plan?: string; health?: string; page?: string }>;
}) {
  const { search: searchParam, plan: planParam, health: healthParam, page: pageParam } =
    await searchParams;
  const search = searchParam?.trim() ?? "";
  const plan = planParam && planParam !== "all" ? planParam : undefined;
  const health = VALID_HEALTH.includes(healthParam as (typeof VALID_HEALTH)[number])
    ? (healthParam as (typeof VALID_HEALTH)[number])
    : undefined;
  const page = Math.max(1, Number(pageParam) || 1);

  // Search, plan and health filters + pagination are resolved server-side (see
  // admin.listSubscribers) — the list is no longer capped at the newest 100.
  const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
  if (search) params.set("search", search);
  if (plan) params.set("plan", plan);
  if (health) params.set("health", health);

  const result = await serverApiFetch<Paginated<AdminSubscriberRow>>(
    `/admin/subscribers?${params.toString()}`,
  );

  return (
    <AdminSubscribersClient
      initialSubscribers={result?.items ?? []}
      total={result?.total ?? 0}
      page={result?.page ?? page}
      perPage={result?.perPage ?? PER_PAGE}
      search={search}
      plan={plan ?? "all"}
      health={health ?? "all"}
    />
  );
}
