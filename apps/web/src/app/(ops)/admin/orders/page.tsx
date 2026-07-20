import { serverApiFetch } from "@/lib/api.server";
import { AdminOrdersClient, type AdminOrderRow } from "./orders-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export default async function AdminOrdersPage() {
  const result = await serverApiFetch<Paginated<AdminOrderRow>>("/admin/orders?perPage=100");
  return <AdminOrdersClient initialOrders={result?.items ?? []} total={result?.total ?? 0} />;
}
