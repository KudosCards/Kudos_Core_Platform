import type { Metadata } from "next";
import Link from "next/link";
import type { GuestClaimInfo } from "@kudos/shared-types";
import { publicApiFetch } from "@/lib/api.public";
import { CardsHeader } from "../../cards/cards-header";
import { ClaimClient } from "./claim-client";

export const metadata: Metadata = { title: "Save your order — Kudos Cards" };

/**
 * Claim a guest account (public — the buyer has no session yet). The claim token
 * arrives in ?token=; we look up the email it's tied to for prefill, or show an
 * expired/invalid state. See docs/adr/0025.
 */
export default async function GiftClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const info = token ? await publicApiFetch<GuestClaimInfo>(`/guest/claim/${token}`) : null;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <CardsHeader />
      <main className="mx-auto max-w-md px-6 py-16">
        {!info ? (
          <div className="flex flex-col gap-4 text-center">
            <h1 className="text-2xl font-extrabold tracking-tight">This link has expired</h1>
            <p className="text-slate-600">
              Claim links are single-use and expire after a while. If you already created an account,
              just{" "}
              <Link href="/login" className="font-medium text-rose-600 hover:underline">
                log in
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">Save your order</h1>
              <p className="mt-1 text-slate-600">
                Create a free account to keep this contact, get a birthday reminder next year, and
                let us send it for you automatically.
              </p>
            </div>
            <ClaimClient token={token!} email={info.email} />
          </div>
        )}
      </main>
    </div>
  );
}
