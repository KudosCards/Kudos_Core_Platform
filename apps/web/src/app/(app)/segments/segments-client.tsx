"use client";

import { useState } from "react";
import Link from "next/link";
import type { SegmentSummary, SegmentsOverview } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

/** The primary action on every segment card: send a card to its members. Seeds
 * the bulk-send composer with the segment's people (`?segment=` — preset key or
 * saved id). Hidden when the segment is empty. See ADR 0106. */
function SendToListLink({ segment }: { segment: SegmentSummary }) {
  if (segment.count === 0) return null;
  return (
    <Link href={`/send?segment=${encodeURIComponent(segment.key)}`} className="btn-accent text-sm">
      Send to this list →
    </Link>
  );
}

/** One segment card: name, live count, a small member preview, and its actions. */
function SegmentCard({
  segment,
  action,
}: {
  segment: SegmentSummary;
  action: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold">{segment.name}</p>
          {segment.description && <p className="text-sm text-muted">{segment.description}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-semibold text-accent">
          {segment.count}
        </span>
      </div>

      {segment.sample.length === 0 ? (
        <p className="text-sm text-muted">No matches right now.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {segment.sample.map((member) => (
            <li key={`${member.recipientId}-${member.detail}`} className="flex justify-between gap-3">
              <Link href={`/recipients/${member.recipientId}`} className="truncate hover:underline">
                {member.name}
              </Link>
              {member.detail && <span className="shrink-0 text-muted">{member.detail}</span>}
            </li>
          ))}
          {segment.count > segment.sample.length && (
            <li className="text-xs text-muted">
              …and {segment.count - segment.sample.length} more
            </li>
          )}
        </ul>
      )}

      <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">{action}</div>
    </div>
  );
}

/**
 * The Segments (smart lists) page. Suggested presets resolve live and can be
 * saved as a reusable smart list; saved segments can be removed. Each card's
 * primary action sends a card to its members (seeds the bulk-send composer via
 * `?segment=`). See docs/adr/0105-segments-smart-lists.md and 0106-send-to-segment.md.
 */
export function SegmentsClient({ initial }: { initial: SegmentsOverview }) {
  const [saved, setSaved] = useState<SegmentSummary[]>(initial.saved);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveSegment(source: SegmentSummary) {
    const name = window.prompt("Name this smart list", source.name);
    if (!name) return;
    setPendingKey(source.key);
    setError(null);
    try {
      const created = await clientApiFetch<SegmentSummary>("/segments", {
        method: "POST",
        body: JSON.stringify({ name, definition: source.definition }),
      });
      setSaved((current) => [created, ...current]);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save the list");
    } finally {
      setPendingKey(null);
    }
  }

  async function removeSegment(id: string) {
    setPendingKey(id);
    setError(null);
    try {
      await clientApiFetch(`/segments/${id}`, { method: "DELETE" });
      setSaved((current) => current.filter((segment) => segment.id !== id));
    } catch (removeError) {
      setError(removeError instanceof ApiError ? removeError.message : "Could not remove the list");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Segments</h1>
        <p className="text-muted">
          Smart lists that stay up to date on their own — who&apos;s coming up, and who needs
          attention. Save one to reuse it.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Suggested</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {initial.suggested.map((segment) => (
            <SegmentCard
              key={segment.key}
              segment={segment}
              action={
                <>
                  <SendToListLink segment={segment} />
                  <button
                    type="button"
                    disabled={pendingKey === segment.key}
                    onClick={() => void saveSegment(segment)}
                    className="btn-secondary text-sm disabled:opacity-50"
                  >
                    {pendingKey === segment.key ? "Saving…" : "Save as list"}
                  </button>
                </>
              }
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Your saved lists</h2>
        {saved.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
            No saved smart lists yet. Save a suggested one above to reuse it.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {saved.map((segment) => (
              <SegmentCard
                key={segment.key}
                segment={segment}
                action={
                  <>
                    <SendToListLink segment={segment} />
                    <button
                      type="button"
                      disabled={pendingKey === segment.id}
                      onClick={() => segment.id && void removeSegment(segment.id)}
                      className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/[0.03] disabled:opacity-50"
                    >
                      {pendingKey === segment.id ? "Removing…" : "Remove"}
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
