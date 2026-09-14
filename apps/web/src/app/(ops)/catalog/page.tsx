import { serverApiFetch } from "@/lib/api.server";
import { CatalogClient } from "./catalog-client";

export default async function CatalogPage() {
  const [status, cropGate] = await Promise.all([
    serverApiFetch<{ configured: boolean }>("/catalog/status"),
    // Unavailable on an API that predates the gate, which is the same thing as
    // the gate being open.
    serverApiFetch<{ enabled: boolean }>("/catalog/crop-gate"),
  ]);
  return (
    <CatalogClient
      configured={status?.configured ?? false}
      cropGateEnabled={cropGate?.enabled ?? false}
    />
  );
}
