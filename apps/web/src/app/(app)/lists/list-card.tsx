import Link from "next/link";

/**
 * One list, either kind, rendered the same way.
 *
 * The two kinds used to look nothing alike: a smart list was a card with a
 * count, a preview and a one-click send, while a hand-picked list was an option
 * in a dropdown with no page of its own. Same idea — a group of people you send
 * to — so they get the same card, the same count, the same preview and the same
 * primary action. The badge is the only thing that separates them, because the
 * one real difference is who keeps the membership up to date.
 */
export interface ListCardModel {
  key: string;
  name: string;
  description: string | null;
  kind: "picked" | "smart";
  count: number;
  /** Up to a handful of members, for the "who's on this" preview. */
  sample: { id: string; name: string; detail?: string }[];
  href: string;
  sendHref: string;
  /**
   * True when the list is defined as people we cannot post to. "Missing an
   * address" offered "Send to this list" as its primary action, which is the
   * one thing that cannot happen for anyone on it — the send would be blocked
   * at the pre-send check for every single card. The worklist gets the
   * worklist's action instead.
   */
  unpostable?: boolean;
}

export function ListCard({ list, actions }: { list: ListCardModel; actions?: React.ReactNode }) {
  const empty = list.count === 0;
  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href={list.href} className="truncate font-semibold hover:underline">
            {list.name}
          </Link>
          <span className={list.kind === "smart" ? "pill pill-accent" : "pill pill-muted"}>
            {list.kind === "smart" ? "Updates itself" : "Picked by hand"}
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-semibold text-accent">
          {list.count}
        </span>
      </div>

      {list.description && <p className="text-sm text-muted">{list.description}</p>}

      {empty ? (
        <p className="text-sm text-muted">
          {list.kind === "smart" ? "Nobody matches right now." : "Nobody on this list yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {list.sample.map((member) => (
            <li key={member.id} className="flex justify-between gap-3">
              <Link href={`/recipients/${member.id}`} className="truncate hover:underline">
                {member.name}
              </Link>
              {member.detail && <span className="shrink-0 text-muted">{member.detail}</span>}
            </li>
          ))}
          {list.count > list.sample.length && (
            <li>
              <Link href={list.href} className="text-xs text-accent hover:underline">
                …and {list.count - list.sample.length} more
              </Link>
            </li>
          )}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {!empty &&
          (list.unpostable ? (
            <Link href="/recipients?missingAddress=true" className="btn-accent text-sm">
              Add their addresses →
            </Link>
          ) : (
            <Link href={list.sendHref} className="btn-accent text-sm">
              Send to this list →
            </Link>
          ))}
        {actions}
      </div>
    </div>
  );
}
