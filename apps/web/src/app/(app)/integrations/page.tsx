import type { AccountApiKey } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { env } from "@/lib/env";
import { IntegrationsClient } from "./integrations-client";

export default async function IntegrationsPage() {
  const keys = await serverApiFetch<AccountApiKey[]>("/integrations/api-keys");

  return <IntegrationsClient initialKeys={keys ?? []} apiBaseUrl={env.NEXT_PUBLIC_API_URL} />;
}
