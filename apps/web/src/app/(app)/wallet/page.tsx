import type { WalletSummary } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { WalletClient } from "./wallet-client";

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ topup?: string }>;
}) {
  const [summary, params] = await Promise.all([
    serverApiFetch<WalletSummary>("/wallet"),
    searchParams,
  ]);

  return (
    <WalletClient
      initialSummary={summary ?? { balanceMinor: 0, currency: "GBP", entries: [] }}
      topupStatus={params.topup ?? null}
    />
  );
}
