"use client";

import type { AdminIdentity } from "@kudos/shared-types";
import { SetPasswordForm } from "@/components/set-password-form";
import { clientApiFetch } from "@/lib/api.client";

/**
 * Landing page for the operator invite link (Supabase set-password link sent by
 * AdminTeamService). The link establishes a session; SetPasswordForm waits for
 * it, then sets the password. On success we call POST /admin/access to provision
 * the operator from the email allow-list, then enter the ops app. See
 * docs/adr/0051 and 0040.
 */
export default function AdminSetPasswordPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="text-2xl font-bold tracking-tight">Kudos Ops</span>
        <span className="text-sm text-muted">Operator account setup</span>
      </div>
      <SetPasswordForm
        heading="Set your operator password"
        intro="Choose a password to finish setting up your operator login."
        submitLabel="Set password & continue"
        busyLabel="Setting up…"
        onSuccess={async () => {
          // Provision the operator from the allow-list, then a full navigation so
          // the ops server layout re-reads the fresh session cookie.
          await clientApiFetch<AdminIdentity>("/admin/access", { method: "POST" });
          window.location.assign("/admin");
        }}
        invalidLinkHelp={
          <>
            This setup link has expired or already been used. Ask a super admin to resend your
            operator invite, then open the new link.
          </>
        }
      />
    </div>
  );
}
