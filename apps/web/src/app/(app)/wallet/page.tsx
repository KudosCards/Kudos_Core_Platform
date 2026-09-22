import type { WalletSummary } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { WalletClient } from "./wallet-client";

/** What the page shows when the API cannot be reached: an empty wallet with the
 * standing instruction off, which is what every account starts as. */
const EMPTY_SUMMARY: WalletSummary = {
  balanceMinor: 0,
  currency: "GBP",
  entries: [],
  autoTopUp: {
    enabled: false,
    thresholdMinor: 1000,
    amountMinor: 5000,
    pausedAt: null,
    pausedReason: null,
  },
};

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
    <WalletClient initialSummary={summary ?? EMPTY_SUMMARY} topupStatus={params.topup ?? null} />
  );
}
