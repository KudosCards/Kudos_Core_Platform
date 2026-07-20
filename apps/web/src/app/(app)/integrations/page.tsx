import type { AccountApiKey, CrmConnection } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { env } from "@/lib/env";
import { IntegrationsClient } from "./integrations-client";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const [params, keys, connections] = await Promise.all([
    searchParams,
    serverApiFetch<AccountApiKey[]>("/integrations/api-keys"),
    serverApiFetch<CrmConnection[]>("/integrations/connections"),
  ]);

  return (
    <IntegrationsClient
      initialKeys={keys ?? []}
      initialConnections={connections ?? []}
      apiBaseUrl={env.NEXT_PUBLIC_API_URL}
      connectedProvider={params.connected ?? null}
      errorProvider={params.error ?? null}
    />
  );
}
