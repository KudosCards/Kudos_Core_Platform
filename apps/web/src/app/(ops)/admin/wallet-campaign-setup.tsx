"use client";

import { useEffect, useState } from "react";
import type { WalletCampaignStatus, WalletCampaignView } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { SuperAdminEditable, useIsSuperAdmin } from "../ops-role";

/** A campaign as it arrives over JSON — `createdAt` is a string on the wire,
 *  and the list is already ordered server-side, so it isn't read here. */
type Campaign = Omit<WalletCampaignView, "createdAt">;

function gbp(minor: number): string {
  return `£${(minor / 100).toFixed(2)}`;
}

/** Pounds as an operator types them, in pence. `NaN` for anything unparseable,
 *  so an empty or half-typed box fails the validity check rather than
 *  submitting a zero. */
function toMinor(pounds: string): number {
  const parsed = Number.parseFloat(pounds);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN;
}

const STATUS_STYLE: Record<WalletCampaignStatus, string> = {
  draft: "border-border text-muted",
  live: "border-emerald-500/40 bg-emerald-50 text-emerald-800",
  paused: "border-amber-500/40 bg-amber-50 text-amber-900",
  exhausted: "border-red-500/40 bg-red-50 text-red-800",
  ended: "border-border text-muted",
};

/** What each state means in the one sentence an operator needs. */
const STATUS_HELP: Record<WalletCampaignStatus, string> = {
  draft: "Not crediting anyone yet. Check the amount and dates, then set it live.",
  live: "Crediting every new sign-up whose account is created inside the window.",
  paused:
    "Not crediting. Anyone who signs up while it's paused is still in the window and gets credited when you resume.",
  exhausted: "Stopped at its budget. Raise the budget to start it again.",
  ended: "Finished. It can't be edited or restarted.",
};

function StatusPill({ status }: { status: WalletCampaignStatus }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[status]}`}
    >
      {status}
    </span>
  );
}

interface Draft {
  name: string;
  amount: string;
  startsOn: string;
  endsOn: string;
  budget: string;
}

const EMPTY: Draft = { name: "", amount: "", startsOn: "", endsOn: "", budget: "" };

const field = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";
const label = "text-xs tracking-wide text-muted uppercase";

/**
 * Create or correct one campaign.
 *
 * `locked` covers the amount and the window once a campaign has left draft.
 * They are the offer made to everyone in that window and one account can only
 * be credited once, so an early sign-up could never be topped up to match a
 * later raise — the server refuses it, and the form says why rather than
 * letting someone type a change that comes back as a 409.
 */
function CampaignForm({
  initial,
  locked,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  locked: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const amountMinor = toMinor(draft.amount);
  const budgetMinor = toMinor(draft.budget);
  // Mirrors the server's rules, so the button never offers something that can
  // only come back as a 400.
  const valid =
    draft.name.trim().length >= 3 &&
    amountMinor >= 100 &&
    amountMinor <= 5_000 &&
    budgetMinor >= 100 &&
    budgetMinor <= 1_000_000 &&
    draft.startsOn !== "" &&
    draft.endsOn !== "" &&
    draft.startsOn <= draft.endsOn;

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-foreground/[0.02] p-4">
      <label className="flex flex-col gap-1">
        <span className={label}>Name</span>
        <input
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="October welcome"
          className={field}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={label}>Credit per sign-up (£)</span>
          <input
            type="number"
            min={1}
            max={50}
            step="0.01"
            value={draft.amount}
            onChange={(e) => set({ amount: e.target.value })}
            disabled={locked}
            className={`${field} disabled:opacity-50`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Total budget (£)</span>
          <input
            type="number"
            min={1}
            max={10_000}
            step="0.01"
            value={draft.budget}
            onChange={(e) => set({ budget: e.target.value })}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>First day (UK)</span>
          <input
            type="date"
            value={draft.startsOn}
            onChange={(e) => set({ startsOn: e.target.value })}
            disabled={locked}
            className={`${field} disabled:opacity-50`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Last day (UK), included</span>
          <input
            type="date"
            value={draft.endsOn}
            onChange={(e) => set({ endsOn: e.target.value })}
            disabled={locked}
            className={`${field} disabled:opacity-50`}
          />
        </label>
      </div>

      {locked ? (
        <p className="text-xs text-muted">
          The amount and dates are fixed once a campaign leaves draft — they’re the offer made to
          everyone in the window, and an account that has already been credited can’t be topped up
          to match a change. To change the offer, end this campaign and start another.
        </p>
      ) : (
        <p className="text-xs text-muted">
          £{(amountMinor / 100 || 0).toFixed(2)} to every account that signs up between these two UK
          dates, both included, until{" "}
          {Number.isFinite(budgetMinor) ? gbp(budgetMinor) : "the budget"} has been given away.
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSubmit(draft)}
          disabled={!valid || busy}
          className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-surface disabled:opacity-50"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-full border border-border px-4 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Super-admin panel for marketing wallet campaigns — "sign up in October and
 * get £5 free credit to send your first card".
 *
 * A campaign is a window plus an amount plus a budget. Every account created
 * inside the window, through a real sign-up rather than guest checkout, is
 * credited once. Nothing is paid out until someone sets a campaign live, and
 * the readout below each one is summed from the wallet ledger rather than from
 * a counter, so it cannot drift from the money.
 *
 * See docs/wallet-campaigns-plan.md.
 */
export function WalletCampaignSetup() {
  // Read here rather than only inside SuperAdminEditable: the "New campaign"
  // link sits in the panel header, outside the fieldset, and a disabled-looking
  // link is worse than no link at all.
  const isSuper = useIsSuperAdmin();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    clientApiFetch<{ campaigns: Campaign[] }>("/admin/wallet-campaigns")
      .then((r) => {
        if (active) setCampaigns(r.campaigns);
      })
      .catch(() => {
        if (active) setError("Couldn’t load the campaigns.");
      });
    return () => {
      active = false;
    };
  }, []);

  /** Replace one campaign in place, so the readout updates without a reload. */
  function merge(updated: Campaign) {
    setCampaigns((current) =>
      current ? current.map((c) => (c.id === updated.id ? updated : c)) : current,
    );
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn’t work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const create = (draft: Draft) =>
    run(async () => {
      const created = await clientApiFetch<Campaign>("/admin/wallet-campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name.trim(),
          amountMinor: toMinor(draft.amount),
          startsOn: draft.startsOn,
          endsOn: draft.endsOn,
          budgetMinor: toMinor(draft.budget),
        }),
      });
      setCampaigns((current) => [created, ...(current ?? [])]);
      setCreating(false);
    });

  const update = (campaign: Campaign, draft: Draft) =>
    run(async () => {
      // A campaign past draft only accepts the name and the budget; sending the
      // rest is what the server refuses, so don't send it.
      const offer =
        campaign.status === "draft"
          ? {
              amountMinor: toMinor(draft.amount),
              startsOn: draft.startsOn,
              endsOn: draft.endsOn,
            }
          : {};
      merge(
        await clientApiFetch<Campaign>(`/admin/wallet-campaigns/${campaign.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: draft.name.trim(),
            budgetMinor: toMinor(draft.budget),
            ...offer,
          }),
        }),
      );
      setEditing(null);
    });

  const setStatus = (id: string, status: "live" | "paused" | "ended") =>
    run(async () => {
      merge(
        await clientApiFetch<Campaign>(`/admin/wallet-campaigns/${id}/status`, {
          method: "PUT",
          body: JSON.stringify({ status }),
        }),
      );
    });

  const action =
    "rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-border/40 disabled:opacity-50";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Wallet campaigns</h2>
        {!creating && isSuper && (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setEditing(null);
            }}
            className="text-sm font-medium text-accent hover:underline"
          >
            New campaign
          </button>
        )}
      </div>
      <p className="text-sm text-muted">
        Free credit for everyone who signs up in a window — “sign up in October and get £5 to send
        your first card”. Guest checkouts are excluded, an account is only ever credited once, and a
        campaign stops on its own when it reaches its budget.
      </p>

      <SuperAdminEditable>
        {error && <p className="text-sm font-medium text-danger">{error}</p>}

        {creating && (
          <CampaignForm
            initial={EMPTY}
            locked={false}
            busy={busy}
            submitLabel="Create as draft"
            onSubmit={create}
            onCancel={() => setCreating(false)}
          />
        )}

        {campaigns === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : campaigns.length === 0 ? (
          !creating && <p className="text-sm text-muted">No campaigns yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {campaigns.map((campaign) => {
              const spentPct = Math.min(
                100,
                Math.round((campaign.creditedMinor / Math.max(1, campaign.budgetMinor)) * 100),
              );
              return (
                <div key={campaign.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold">{campaign.name}</span>
                      <StatusPill status={campaign.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(campaign.status === "draft" || campaign.status === "paused") && (
                        <button
                          type="button"
                          onClick={() => setStatus(campaign.id, "live")}
                          disabled={busy}
                          className={action}
                        >
                          {campaign.status === "draft" ? "Set live" : "Resume"}
                        </button>
                      )}
                      {campaign.status === "live" && (
                        <button
                          type="button"
                          onClick={() => setStatus(campaign.id, "paused")}
                          disabled={busy}
                          className={action}
                        >
                          Pause
                        </button>
                      )}
                      {campaign.status !== "ended" && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(editing === campaign.id ? null : campaign.id);
                              setCreating(false);
                            }}
                            disabled={busy}
                            className={action}
                          >
                            {editing === campaign.id ? "Close" : "Edit"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setStatus(campaign.id, "ended")}
                            disabled={busy}
                            className={action}
                          >
                            End
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <p className="text-sm text-muted">
                    {gbp(campaign.amountMinor)} per sign-up, {campaign.startsOn} to{" "}
                    {campaign.endsOn} (UK, both included).
                  </p>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">
                        {campaign.creditedCount} account{campaign.creditedCount === 1 ? "" : "s"}{" "}
                        credited
                      </span>
                      <span className="tabular-nums text-muted">
                        {gbp(campaign.creditedMinor)} of {gbp(campaign.budgetMinor)} —{" "}
                        {gbp(campaign.budgetMinor - campaign.creditedMinor)} left
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
                      <div
                        className={`h-full rounded-full ${spentPct >= 100 ? "bg-red-500" : "bg-accent"}`}
                        style={{ width: `${spentPct}%` }}
                      />
                    </div>
                  </div>

                  <p className="text-xs text-muted">{STATUS_HELP[campaign.status]}</p>

                  {editing === campaign.id && (
                    <CampaignForm
                      initial={{
                        name: campaign.name,
                        amount: (campaign.amountMinor / 100).toFixed(2),
                        startsOn: campaign.startsOn,
                        endsOn: campaign.endsOn,
                        budget: (campaign.budgetMinor / 100).toFixed(2),
                      }}
                      locked={campaign.status !== "draft"}
                      busy={busy}
                      submitLabel="Save changes"
                      onSubmit={(draft) => update(campaign, draft)}
                      onCancel={() => setEditing(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SuperAdminEditable>
    </div>
  );
}
