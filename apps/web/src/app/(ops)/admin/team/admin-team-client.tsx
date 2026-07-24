"use client";

import type { AdminTeam, PlatformAdminRole } from "@kudos/shared-types";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

const ROLE_LABELS: Record<PlatformAdminRole, string> = {
  super_admin: "Super admin",
  ops: "Operator",
};

const inputClass = "rounded-md border border-black/15 bg-surface px-3 py-2 text-sm dark:border-white/15";

export function AdminTeamClient({ initialTeam }: { initialTeam: AdminTeam }) {
  const [team, setTeam] = useState<AdminTeam>(initialTeam);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const isSuper = team.yourRole === "super_admin";

  function resend(email: string) {
    setSentTo(null);
    void mutate("/admin/team/invites/resend", {
      method: "POST",
      body: JSON.stringify({ email }),
    }).then(() => {
      setSentTo(email);
      window.setTimeout(() => setSentTo((current) => (current === email ? null : current)), 3000);
    });
  }

  async function mutate(path: string, init: RequestInit): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const updated = await clientApiFetch<AdminTeam>(path, init);
      setTeam(updated);
    } catch (mutateError) {
      setError(mutateError instanceof ApiError ? mutateError.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void mutate("/admin/team/invites", {
      method: "POST",
      body: JSON.stringify({
        email: String(data.get("email")),
        role: String(data.get("role")),
      }),
    }).then(() => form.reset());
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Operators</h1>
        <p className="text-sm text-foreground/60">
          Kudos staff with access to this admin dashboard. Super admins manage the team; operators
          work the dashboards and queues.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      {!isSuper && (
        <p className="rounded-lg border border-black/10 px-4 py-2 text-sm text-foreground/60 dark:border-white/10">
          Only super admins can change the operator team.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground/70">Operators</h2>
        <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-foreground/50 dark:border-white/10">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {team.admins.map((admin) => (
                <tr key={admin.userId}>
                  <td className="px-4 py-3">
                    {admin.email ?? <span className="text-foreground/40">—</span>}
                    {admin.isYou && <span className="ml-2 text-xs text-foreground/40">(you)</span>}
                  </td>
                  <td className="px-4 py-3">
                    {isSuper ? (
                      <select
                        aria-label={`Role for ${admin.email ?? admin.userId}`}
                        value={admin.role}
                        disabled={pending}
                        onChange={(e) =>
                          void mutate(`/admin/team/${admin.userId}`, {
                            method: "PATCH",
                            body: JSON.stringify({ role: e.target.value }),
                          })
                        }
                        className={inputClass}
                      >
                        <option value="super_admin">Super admin</option>
                        <option value="ops">Operator</option>
                      </select>
                    ) : (
                      ROLE_LABELS[admin.role]
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isSuper && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          void mutate(`/admin/team/${admin.userId}`, { method: "DELETE" })
                        }
                        className="rounded-md border border-black/15 px-2.5 py-1 text-xs text-accent hover:bg-accent-soft disabled:opacity-40 dark:border-white/15"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {isSuper && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground/70">Invite an operator</h2>
          <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-foreground/60">Email</span>
              <input name="email" type="email" required placeholder="name@kudoscards.co.uk" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-foreground/60">Role</span>
              <select name="role" defaultValue="ops" className={inputClass}>
                <option value="ops">Operator</option>
                <option value="super_admin">Super admin</option>
              </select>
            </label>
            <button type="submit" disabled={pending} className="btn-accent">
              Add operator
            </button>
          </form>
          <p className="text-xs text-foreground/50">
            We&apos;ll email them a link to the operator sign-in. They get access as soon as they
            sign in with this email.
          </p>

          {team.invites.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/40">
                Pending invites
              </h3>
              <ul className="flex flex-col divide-y divide-black/5 rounded-xl border border-black/10 dark:divide-white/5 dark:border-white/10">
                {team.invites.map((inv) => (
                  <li key={inv.email} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span className="min-w-0 truncate">
                      {inv.email}{" "}
                      <span className="text-xs text-foreground/40">· {ROLE_LABELS[inv.role]}</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {sentTo === inv.email && (
                        <span className="text-xs font-medium text-[#2f7d54]">Sent ✓</span>
                      )}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => resend(inv.email)}
                        className="rounded-md border border-black/15 px-2.5 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/5"
                      >
                        Resend email
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          void mutate(`/admin/team/invites?email=${encodeURIComponent(inv.email)}`, {
                            method: "DELETE",
                          })
                        }
                        className="rounded-md border border-black/15 px-2.5 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/5"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
