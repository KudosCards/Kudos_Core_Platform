import type { InvitePreview } from "@kudos/shared-types";
import Link from "next/link";
import { publicApiFetch } from "@/lib/api.public";
import { InviteAcceptClient } from "./invite-accept-client";

/**
 * Public invite-acceptance page. A colleague opens the link from their invite
 * email, signs in (or creates a login) with the invited email, and joins the
 * team. Public so an invitee with no account yet can still reach it. See
 * docs/adr/0028-multi-user-teams.md.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await publicApiFetch<InvitePreview>(`/invites/${token}`);

  const invalid = !preview || preview.status !== "pending" || preview.expired;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-1 text-center">
        <span className="text-2xl font-bold tracking-tight">Kudos Cards</span>
      </div>

      {invalid ? (
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <h1 className="text-xl font-bold">This invite isn&apos;t valid</h1>
          <p className="text-sm text-muted">
            {preview?.expired
              ? "This invitation has expired. Ask whoever invited you to send a new one."
              : "This invitation link is invalid or has already been used."}
          </p>
          <Link href="/login" className="btn-accent">
            Go to sign in
          </Link>
        </div>
      ) : (
        <InviteAcceptClient token={token} preview={preview} />
      )}
    </div>
  );
}
