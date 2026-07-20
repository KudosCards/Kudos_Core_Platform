import { serverApiFetch } from "@/lib/api.server";
import { AdminSubscribersClient, type AdminSubscriberRow } from "./subscribers-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export default async function AdminSubscribersPage() {
  const result = await serverApiFetch<Paginated<AdminSubscriberRow>>(
    "/admin/subscribers?perPage=100",
  );
  return (
    <AdminSubscribersClient
      initialSubscribers={result?.items ?? []}
      total={result?.total ?? 0}
    />
  );
}
