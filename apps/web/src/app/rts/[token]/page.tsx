import type { ReturnCase } from "@kudos/shared-types";
import { publicApiFetch } from "@/lib/api.public";
import { RtsRecoveryClient } from "./rts-recovery-client";

/**
 * The self-serve Returned-to-Sender recovery page, opened from the link in the
 * RTS email — no login required. The secret token in the URL is the sole
 * credential (like the invite link). See docs/adr/0039-returned-to-sender.md.
 */
export default async function RtsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const initialCase = await publicApiFetch<ReturnCase>(`/rts/${token}`);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-1 text-center">
        <span className="text-2xl font-bold tracking-tight">Kudos Cards</span>
      </div>

      {!initialCase ? (
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <h1 className="text-xl font-bold">This link isn&apos;t valid</h1>
          <p className="text-sm text-muted">
            It may have expired or already been used. If you still need to update an address, sign in
            and open the contact record.
          </p>
        </div>
      ) : (
        <RtsRecoveryClient token={token} initialCase={initialCase} />
      )}
    </div>
  );
}
