import type { Account } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { BillingClient } from "./billing-client";

export default async function BillingPage() {
  const account = await serverApiFetch<Account>("/accounts/me");

  return <BillingClient currentPlanId={account?.planId ?? null} />;
}
