import { serverApiFetch } from "@/lib/api.server";
import { CatalogClient } from "./catalog-client";

export default async function CatalogPage() {
  const status = await serverApiFetch<{ configured: boolean }>("/catalog/status");
  return <CatalogClient configured={status?.configured ?? false} />;
}
