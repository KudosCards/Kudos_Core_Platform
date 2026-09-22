"use client";

import { useState } from "react";
import Link from "next/link";
import {
  STANDING_ORDER_MAX_DESIGNS,
  STANDING_ORDER_MAX_MESSAGES,
  STANDING_ORDER_MESSAGE_MAX_LENGTH,
  type StandingOrder,
  type StandingOrderBlocker,
} from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

interface DesignOption {
  id: string;
  name: string;
}

interface ListOption {
  id: string;
  name: string;
  memberCount: number;
}

/**
 * Why a switched-on instruction is not running, said plainly.
 *
 * A `Record` keyed on the code rather than a lookup with a fallback, so the API
 * gaining a blocker fails the build here until somebody decides what a customer
 * should read. The `??` below covers only an API that is ahead of this deploy.
 */
const BLOCKER_TEXT: Record<StandingOrderBlocker, string> = {
  plan: "Your plan does not include automatic sending.",
  consent: "Nobody has agreed to how this works yet — read it below and tick the box.",
  empty_pool: "You need at least one card design and one message.",
  design_archived: "One of your chosen cards has been removed from your designs.",
  audience_gone:
    "The list you chose has been deleted, so we have stopped rather than send to everybody.",
  audience_unsupported:
    "This is pointed at a smart list. Smart lists change on their own, so we do not send from them — choose a list you pick by hand, or everybody.",
};

const UNKNOWN_BLOCKER = "Something is stopping this from running.";

/** The empty instruction a page with no saved order starts from. */
const EMPTY: StandingOrder = {
  id: null,
  enabled: false,
  audience: { kind: "all" },
  postageClass: "second_class",
  designs: [],
  messages: [],
  active: false,
  blockers: [],
  consent: null,
  consentStatement: [],
  consentVersion: 0,
  planAllows: false,
};

export function ClickAndForgetClient({
  initialOrder,
  designs,
  lists,
}: {
  initialOrder: StandingOrder | null;
  designs: DesignOption[];
  lists: ListOption[];
}) {
  const [order, setOrder] = useState<StandingOrder>(initialOrder ?? EMPTY);
  const [enabled, setEnabled] = useState(order.enabled);
  const [audienceKind, setAudienceKind] = useState(order.audience.kind);
  const [listId, setListId] = useState(
    order.audience.kind === "list" ? order.audience.listId : (lists[0]?.id ?? ""),
  );
  const [postageClass, setPostageClass] = useState(order.postageClass);
  const [chosen, setChosen] = useState<string[]>(order.designs.map((d) => d.savedDesignId));
  const [messages, setMessages] = useState<string[]>(
    order.messages.length > 0 ? order.messages.map((m) => m.text) : [""],
  );
  const [agreed, setAgreed] = useState(order.consent?.current ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleDesign(id: string) {
    setChosen((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length >= STANDING_ORDER_MAX_DESIGNS
          ? current
          : [...current, id],
    );
  }

  function setMessage(index: number, text: string) {
    setMessages((current) => current.map((value, at) => (at === index ? text : value)));
  }

  async function save() {
    setError(null);
    setSaved(false);
    const written = messages.map((text) => text.trim()).filter((text) => text.length > 0);

    if (enabled && chosen.length === 0) {
      setError("Choose at least one card design before switching this on");
      return;
    }
    if (enabled && written.length === 0) {
      setError("Write at least one message before switching this on");
      return;
    }
    if (audienceKind === "list" && !listId) {
      setError("Choose a contact list, or send to everybody");
      return;
    }

    setSaving(true);
    try {
      const next = await clientApiFetch<StandingOrder>("/standing-order", {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          audience: audienceKind === "list" ? { kind: "list", listId } : { kind: "all" },
          postageClass,
          savedDesignIds: chosen,
          messages: written.map((text) => ({ text, source: "written" })),
          agreeToConsent: agreed,
        }),
      });
      setOrder(next);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const pointedAtSmartList = order.audience.kind === "segment";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Click & forget</h1>
        <p className="text-muted">
          Choose your contacts, your cards and your messages once. We send a card for every birthday
          after that, paid from your wallet, without asking you each time.
        </p>
      </div>

      <StatusStrip order={order} />

      {!order.planAllows && (
        <div className="notice notice-info flex flex-wrap items-center justify-between gap-3">
          <span>
            Click & forget is on Pro and above. Set it up here and it will start as soon as you
            upgrade.
          </span>
          <Link href="/billing" className="btn-accent shrink-0">
            See plans
          </Link>
        </div>
      )}

      {order.enabled && order.blockers.length > 0 && (
        <div className="notice notice-warning flex flex-col gap-1">
          <strong>This is switched on, but not running.</strong>
          <ul className="list-disc pl-5">
            {order.blockers.map((blocker) => (
              <li key={blocker}>{BLOCKER_TEXT[blocker] ?? UNKNOWN_BLOCKER}</li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="notice notice-danger">{error}</p>}

      <section className="card flex flex-col gap-4 p-6">
        <h2 className="font-semibold">Who gets a card</h2>
        {pointedAtSmartList && (
          <p className="notice notice-warning">
            This is currently pointed at a smart list. Smart lists change on their own, so we do not
            send from them — choose one of the options below and save.
          </p>
        )}
        <label className="flex items-start gap-3 text-sm">
          <input
            type="radio"
            name="audience"
            checked={audienceKind === "all"}
            onChange={() => setAudienceKind("all")}
            className="mt-1 size-4 accent-accent"
          />
          <span>
            <span className="font-medium">Everybody</span>
            <br />
            <span className="text-muted">Every contact with a birthday on record.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="radio"
            name="audience"
            checked={audienceKind === "list"}
            onChange={() => setAudienceKind("list")}
            disabled={lists.length === 0}
            className="mt-1 size-4 accent-accent"
          />
          <span>
            <span className="font-medium">One of my lists</span>
            <br />
            <span className="text-muted">
              {lists.length === 0
                ? "You have no lists yet — make one on the Lists page."
                : "A list you pick by hand, so you always know who is on it."}
            </span>
          </span>
        </label>
        {audienceKind === "list" && lists.length > 0 && (
          <select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            aria-label="Contact list"
            className="max-w-sm rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.memberCount})
              </option>
            ))}
          </select>
        )}
      </section>

      <section className="card flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Cards we can send</h2>
          <p className="text-sm text-muted">
            Pick as many as you like, up to {STANDING_ORDER_MAX_DESIGNS}. We choose one for each
            person, and nobody gets the same card two years running.
          </p>
        </div>
        {designs.length === 0 ? (
          <p className="text-sm text-muted">
            You have no saved designs yet.{" "}
            <Link href="/designs" className="font-medium text-accent hover:underline">
              Make one first
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {designs.map((design) => {
              const picked = chosen.includes(design.id);
              return (
                <button
                  key={design.id}
                  type="button"
                  onClick={() => toggleDesign(design.id)}
                  aria-pressed={picked}
                  className={
                    picked
                      ? "rounded-md border border-accent bg-accent-soft px-3 py-2 text-sm font-medium"
                      : "rounded-md border border-border bg-surface px-3 py-2 text-sm"
                  }
                >
                  {design.name}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">What the cards say</h2>
          <p className="text-sm text-muted">
            Up to {STANDING_ORDER_MAX_MESSAGES} messages, and we vary them. Write{" "}
            <code className="rounded bg-foreground/[0.06] px-1">{"{firstName}"}</code> anywhere and
            we fill in the name.
          </p>
        </div>
        <p className="notice notice-info">
          <strong>Not printed yet.</strong> Your messages are saved, and right now each card still
          carries the message already on the design you chose. We will tell you when these start
          going out.
        </p>
        <div className="flex flex-col gap-2">
          {messages.map((text, index) => (
            <div key={index} className="flex items-start gap-2">
              <textarea
                value={text}
                onChange={(e) => setMessage(index, e.target.value)}
                maxLength={STANDING_ORDER_MESSAGE_MAX_LENGTH}
                rows={2}
                aria-label={`Message ${index + 1}`}
                placeholder="Happy birthday {firstName} — hope it is a good one."
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
              />
              {messages.length > 1 && (
                <button
                  type="button"
                  onClick={() => setMessages((current) => current.filter((_, at) => at !== index))}
                  aria-label={`Remove message ${index + 1}`}
                  className="btn-secondary shrink-0"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        {messages.length < STANDING_ORDER_MAX_MESSAGES && (
          <button
            type="button"
            onClick={() => setMessages((current) => [...current, ""])}
            className="btn-secondary self-start"
          >
            Add another message
          </button>
        )}
      </section>

      <section className="card flex flex-col gap-4 p-6">
        <h2 className="font-semibold">Postage</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="postage"
              checked={postageClass === "second_class"}
              onChange={() => setPostageClass("second_class")}
              className="size-4 accent-accent"
            />
            Second class
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="postage"
              checked={postageClass === "first_class"}
              onChange={() => setPostageClass("first_class")}
              className="size-4 accent-accent"
            />
            First class
          </label>
        </div>
      </section>

      <section className="card flex flex-col gap-4 p-6">
        <h2 className="font-semibold">What you are agreeing to</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
          {order.consentStatement.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 size-4 accent-accent"
          />
          <span className="font-medium">I have read this and I agree.</span>
        </label>
        {order.consent && !order.consent.current && (
          <p className="text-sm text-muted">
            You agreed to an earlier version of this. We have changed how it works, so please read
            it again and tick the box.
          </p>
        )}
      </section>

      <section className="card flex flex-col gap-4 p-6">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={!order.planAllows || !agreed}
            className="mt-1 size-4 accent-accent"
          />
          <span>
            <span className="font-medium">Send these cards for me</span>
            <br />
            <span className="text-muted">
              {!order.planAllows
                ? "Available on Pro and above."
                : !agreed
                  ? "Tick the box above first."
                  : "We will send a card for every birthday, paid from your wallet."}
            </span>
          </span>
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="btn-accent"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && !error && (
            <span className="text-sm text-success">
              {order.active ? "Saved. We will take it from here." : "Saved."}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

/** Running, off, or on-but-stopped — said in one line at the top. */
function StatusStrip({ order }: { order: StandingOrder }) {
  if (order.active) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-success-soft px-4 py-3 text-sm font-medium text-success">
        <span aria-hidden className="size-2 rounded-full bg-success" />
        Running. We are sending these cards for you.
      </p>
    );
  }
  if (order.enabled) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
        <span aria-hidden className="size-2 rounded-full bg-warning" />
        Switched on, but not running yet.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 rounded-lg bg-foreground/[0.04] px-4 py-3 text-sm text-muted">
      <span aria-hidden className="size-2 rounded-full bg-muted" />
      Not switched on. Nothing is sent until you turn it on below.
    </p>
  );
}
