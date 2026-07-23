"use client";

import type { Team, TeamMember } from "@kudos/shared-types";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
};

const inputClass =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-foreground/30 focus:outline-none";

function gbp(minor: number): string {
  return `£${(minor / 100).toFixed(2)}`;
}

export function TeamClient({ initialTeam }: { initialTeam: Team }) {
  const [team, setTeam] = useState(initialTeam);
  const [inviteRole, setInviteRole] = useState<"admin" | "staff">("staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = team.yourRole === "owner" || team.yourRole === "admin";
  const isOwner = team.yourRole === "owner";

  const { seats } = team;
  const atLimit = seats.used >= seats.limit;
  // A seat can only be removed if it's a paid extra and isn't currently in use.
  const canRemoveSeat = seats.extra > 0 && seats.limit - 1 >= seats.used;

  async function refresh() {
    try {
      setTeam(await clientApiFetch<Team>("/team"));
    } catch {
      // A refresh failure isn't fatal — the last action already succeeded.
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    try {
      await clientApiFetch("/team/invites", {
        method: "POST",
        body: JSON.stringify({ email, role: inviteRole }),
      });
      form.reset();
      await refresh();
    } catch (inviteError) {
      setError(inviteError instanceof ApiError ? inviteError.message : "Could not send the invite");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (actError) {
      setError(actError instanceof ApiError ? actError.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function setSeats(extraSeats: number) {
    return act(() =>
      clientApiFetch("/subscriptions/seats", {
        method: "POST",
        body: JSON.stringify({ extraSeats }),
      }),
    );
  }

  function revokeInvite(id: string) {
    return act(() => clientApiFetch(`/team/invites/${id}/revoke`, { method: "POST" }));
  }
  function removeMember(userId: string) {
    return act(() => clientApiFetch(`/team/members/${userId}`, { method: "DELETE" }));
  }
  function changeRole(userId: string, role: "admin" | "staff") {
    return act(() =>
      clientApiFetch(`/team/members/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    );
  }

  /** The controls shown next to a member row (owner/admin only, never on the
   * owner or yourself). */
  function memberControls(member: TeamMember) {
    if (!canManage || member.role === "owner" || member.isYou) return null;
    return (
      <div className="flex items-center gap-1.5 text-xs">
        {isOwner && (
          <select
            value={member.role}
            disabled={busy}
            onChange={(e) => void changeRole(member.userId, e.target.value as "admin" | "staff")}
            className="rounded-md border border-border bg-surface px-2 py-1"
            aria-label={`Change role for ${member.email ?? "member"}`}
          >
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void removeMember(member.userId)}
          className="rounded-md border border-border px-2 py-1 text-accent hover:bg-accent-soft disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Team</h1>
        <p className="text-muted">Invite colleagues to help manage your Kudos Cards account.</p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      {/* Seat usage meter — shown to everyone on a seat-enabled plan. */}
      {team.teamSeatsEnabled && (
        <section className="card flex flex-col gap-3 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Seats</h2>
              <p className="text-sm text-muted">
                Using {seats.used} of {seats.limit} seat{seats.limit === 1 ? "" : "s"}
                {seats.extra > 0
                  ? ` · ${seats.included} included + ${seats.extra} extra`
                  : ` · ${seats.included} included`}
                .
              </p>
            </div>
            {canManage && (
              <div className="flex items-center gap-2">
                {canRemoveSeat && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void setSeats(seats.extra - 1)}
                    className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/[0.03] disabled:opacity-40"
                  >
                    Remove a seat
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void setSeats(seats.extra + 1)}
                  className="btn-accent disabled:opacity-50"
                >
                  Add a seat ({gbp(seats.seatPriceMinor)}/mo)
                </button>
              </div>
            )}
          </div>
          {/* Usage bar */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
            <div
              className={`h-full rounded-full ${atLimit ? "bg-accent" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, Math.round((seats.used / seats.limit) * 100))}%` }}
            />
          </div>
          <p className="text-xs text-muted">
            The Centre plan includes {seats.included} seats. Extra seats are{" "}
            {gbp(seats.seatPriceMinor)}/month each, incl. VAT.
          </p>
        </section>
      )}

      {/* Invite form / upgrade prompt */}
      {canManage &&
        (team.teamSeatsEnabled ? (
          <section className="card flex flex-col gap-3 p-6">
            <h2 className="font-semibold">Invite a teammate</h2>
            {atLimit && (
              <div className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-accent">
                You&apos;ve used all {seats.limit} of your seats. Add a seat above to invite more
                people.
              </div>
            )}
            <form onSubmit={(e) => void invite(e)} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-1 flex-col gap-1 text-sm text-muted">
                Email address
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="colleague@yourcentre.co.uk"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-muted">
                Role
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "staff")}
                  className={inputClass}
                >
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={busy || atLimit}
                className="btn-accent disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send invite"}
              </button>
            </form>
            <p className="text-xs text-muted">
              Admins can manage the team and everything staff can; staff can create and send cards.
            </p>
          </section>
        ) : (
          <section className="card flex flex-col items-start gap-2 p-6">
            <h2 className="font-semibold">Add your team</h2>
            <p className="text-sm text-muted">
              Inviting colleagues is available on the Centre plan.
            </p>
            <Link href="/billing" className="btn-accent">
              Upgrade to Centre →
            </Link>
          </section>
        ))}

      {/* Members */}
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">
          Members <span className="text-muted">({team.members.length})</span>
        </h2>
        <div className="card divide-y divide-border">
          {team.members.map((member) => (
            <div key={member.userId} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {member.email ?? "Team member"}
                  {member.isYou && <span className="text-muted"> (you)</span>}
                </p>
                <p className="text-xs text-muted">{ROLE_LABEL[member.role] ?? member.role}</p>
              </div>
              {memberControls(member)}
            </div>
          ))}
        </div>
      </section>

      {/* Pending invites */}
      {team.invites.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">
            Pending invites <span className="text-muted">({team.invites.length})</span>
          </h2>
          <div className="card divide-y divide-border">
            {team.invites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{invite.email}</p>
                  <p className="text-xs text-muted">
                    Invited as {ROLE_LABEL[invite.role] ?? invite.role} · awaiting acceptance
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revokeInvite(invite.id)}
                    className="rounded-md border border-border px-2 py-1 text-xs text-accent hover:bg-accent-soft disabled:opacity-40"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
