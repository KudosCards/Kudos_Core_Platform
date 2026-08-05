"use client";

import type { BatchOrderPreflight, PreflightBucket, PreflightIssue } from "@kudos/shared-types";
import { useState } from "react";

/** How many affected recipients to list per bucket before "Show all N". */
const PREVIEW_ROWS = 4;

type BucketKey = "missingAddress" | "invalidPostcode" | "unresolvedTokens" | "duplicate";

/** Per-bucket presentation. `fixable` buckets (address problems) get an inline
 * "Fix" button; the rest are advisory warnings the sender resolves elsewhere. */
const BUCKETS: {
  key: BucketKey;
  icon: string;
  label: string;
  /** Blockers can't be posted at all; warnings still send but may not look right. */
  tone: "blocker" | "warning";
  fixable: boolean;
}[] = [
  { key: "missingAddress", icon: "📮", label: "No postal address", tone: "blocker", fixable: true },
  {
    key: "invalidPostcode",
    icon: "📍",
    label: "Address needs checking",
    tone: "blocker",
    fixable: true,
  },
  {
    key: "unresolvedTokens",
    icon: "✍️",
    label: "Personalisation gaps",
    tone: "warning",
    fixable: false,
  },
  {
    key: "duplicate",
    icon: "🔁",
    label: "Recently sent this design",
    tone: "warning",
    fixable: false,
  },
];

function IssueRow({
  issue,
  fixable,
  onFix,
}: {
  issue: PreflightIssue;
  fixable: boolean;
  onFix: (recipientId: string) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{issue.name}</p>
        <p className="truncate text-xs text-muted">{issue.detail}</p>
      </div>
      {fixable && (
        <button
          type="button"
          onClick={() => onFix(issue.recipientId)}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-foreground/[0.04]"
        >
          Fix address
        </button>
      )}
    </li>
  );
}

function BucketPanel({
  icon,
  label,
  tone,
  fixable,
  bucket,
  editDesignHref,
  onFix,
}: {
  icon: string;
  label: string;
  tone: "blocker" | "warning";
  fixable: boolean;
  bucket: PreflightBucket;
  editDesignHref: string;
  onFix: (recipientId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (bucket.count === 0) return null;

  const rows = showAll ? bucket.sample : bucket.sample.slice(0, PREVIEW_ROWS);
  const hiddenInSample = bucket.sample.length - rows.length;
  // On a huge run the sample is capped, so more may exist than we can list.
  const beyondSample = bucket.count - bucket.sample.length;

  const ring = tone === "blocker" ? "border-accent/30 bg-accent-soft" : "border-amber-300 bg-amber-50";

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${ring}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden>{icon}</span>
        <p className="text-sm font-semibold">
          {bucket.count} {label}
        </p>
      </div>
      <ul className="mt-1.5 divide-y divide-border/60">
        {rows.map((issue) => (
          <IssueRow key={issue.recipientId} issue={issue} fixable={fixable} onFix={onFix} />
        ))}
      </ul>
      {hiddenInSample > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1 text-xs font-medium text-accent hover:underline"
        >
          Show {hiddenInSample} more
        </button>
      )}
      {showAll && beyondSample > 0 && (
        <p className="mt-1 text-xs text-muted">…and {beyondSample} more with the same issue.</p>
      )}
      {!fixable && label === "Personalisation gaps" && (
        <p className="mt-1.5 text-xs text-muted">
          These tokens have no value for the recipient, so they&apos;d print as-is.{" "}
          <a href={editDesignHref} className="text-accent hover:underline">
            Edit the design
          </a>{" "}
          or add the missing details to those contacts.
        </p>
      )}
    </div>
  );
}

/**
 * The bulk-send **pre-send check** banner (ADR 0118): a server-authoritative
 * read-out of the whole run before payment — how many cards are ready, who needs
 * attention (grouped by problem, with inline address fixes), and, in the order
 * summary alongside, the exact price. Buckets overlap by design, so the header
 * counts unique ready vs. needs-attention rather than summing the buckets.
 */
export function PreSendCheck({
  preflight,
  busy,
  error,
  editDesignHref,
  onFixAddress,
}: {
  preflight: BatchOrderPreflight | null;
  busy: boolean;
  error: string | null;
  editDesignHref: string;
  onFixAddress: (recipientId: string) => void;
}) {
  // First check in flight, nothing to show yet.
  if (!preflight && busy) {
    return (
      <section className="card flex items-center gap-3 p-6 text-sm text-muted">
        <span className="size-4 animate-spin rounded-full border-2 border-border border-t-accent" />
        Running the pre-send check…
      </section>
    );
  }
  if (!preflight) {
    if (error) {
      return (
        <section className="card p-6 text-sm text-muted">
          {error} Your cards are still safe to send — the exact total is confirmed on the payment
          page.
        </section>
      );
    }
    return null;
  }

  const { total, ready } = preflight;
  const needsAttention = total - ready;
  const allReady = needsAttention === 0;

  return (
    <section className="card flex flex-col gap-3 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Pre-send check</h2>
        {busy && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="size-3 animate-spin rounded-full border-2 border-border border-t-accent" />
            Rechecking…
          </span>
        )}
      </div>

      {allReady ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800">
          <span aria-hidden>✓</span>
          All {total} card{total === 1 ? "" : "s"} are ready to print, personalise and post.
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-emerald-700">{ready} ready</span>
          <span className="text-muted">·</span>
          <span className="font-semibold text-accent">
            {needsAttention} need{needsAttention === 1 ? "s" : ""} attention
          </span>
          <span className="text-muted">of {total}</span>
        </div>
      )}

      {!allReady && (
        <div className="flex flex-col gap-2">
          {BUCKETS.map((b) => (
            <BucketPanel
              key={b.key}
              icon={b.icon}
              label={b.label}
              tone={b.tone}
              fixable={b.fixable}
              bucket={preflight[b.key]}
              editDesignHref={editDesignHref}
              onFix={onFixAddress}
            />
          ))}
          <p className="text-xs text-muted">
            A card can appear under more than one check — fixing one won&apos;t hide the others.
            Address problems block a card; the rest still send, just worth a look first.
          </p>
        </div>
      )}
    </section>
  );
}
