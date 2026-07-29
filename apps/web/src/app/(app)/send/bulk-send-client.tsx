"use client";

import type { BatchOrder, Recipient, RecipientListSummary, SavedDesign } from "@kudos/shared-types";
import { applyMergeTokens, hasMergeTokens, ukPostcodeRegex } from "@kudos/shared-types";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { AddressModal } from "@/components/address-modal";
import { RecipientPicker, type Paginated } from "./recipient-picker";

// Client-only (Konva touches canvas APIs) — renders a card exactly as it prints.
const CardFacePreview = dynamic(
  () => import("@/components/card-face-preview").then((m) => m.CardFacePreview),
  { ssr: false },
);

/** How many personalised previews to render at once before summarising the rest. */
const MAX_PREVIEWS = 8;

/** Card price and postage in pence, for the on-screen estimate. The server is
 * authoritative — Stripe shows the exact total and applies any plan discount —
 * so this is only ever labelled an estimate. Mirrors the guided-send page. */
const CARD_MINOR = 150;
const POSTAGE_MINOR: Record<string, number> = { second_class: 91, first_class: 180 };
const POSTAGE_LABEL: Record<string, string> = {
  second_class: "2nd class (2–3 days)",
  first_class: "1st class (next day)",
};

function gbp(minor: number): string {
  return `£${(minor / 100).toFixed(2)}`;
}

/** A card can only be posted to a contact with a complete, valid UK address —
 * the same rule the API enforces before it will build a bulk order. */
function hasMailableAddress(recipient: Recipient): boolean {
  return (
    !!recipient.addressLine1?.trim() &&
    !!recipient.addressCity?.trim() &&
    !!recipient.addressPostcode &&
    ukPostcodeRegex.test(recipient.addressPostcode)
  );
}

function addressSummary(recipient: Recipient): string {
  return [recipient.addressLine1, recipient.addressCity, recipient.addressPostcode]
    .filter(Boolean)
    .join(", ");
}

/**
 * Bulk-send composer: pick the contacts, pick a design, fix any missing
 * addresses inline, then pay — all on one page, no dead-ends. Contacts that
 * arrive pre-selected (from the Recipients page's multi-select, via
 * `?recipients=`) seed the selection; everything else is chosen here. Editing a
 * design hands off to the editor with a `returnTo` back to this exact state.
 */
export function BulkSendClient({
  initialSelected,
  initialRecipientsPage,
  designs,
  lists,
  initialDesignId,
}: {
  initialSelected: Recipient[];
  initialRecipientsPage: Paginated<Recipient>;
  designs: SavedDesign[];
  lists: RecipientListSummary[];
  initialDesignId: string;
}) {
  // The chosen contacts, keyed by id and holding the full record, so a selected
  // contact keeps its address/preview even when it's off the current picker page.
  const [selected, setSelected] = useState<Map<string, Recipient>>(
    () => new Map(initialSelected.map((r) => [r.id, r])),
  );
  const [selectedDesignId, setSelectedDesignId] = useState<string>(
    initialDesignId || designs[0]?.id || "",
  );
  const [postageClass, setPostageClass] = useState<"second_class" | "first_class">("second_class");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addressModalFor, setAddressModalFor] = useState<Recipient | null>(null);

  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
  const selectedList = useMemo(() => [...selected.values()], [selected]);
  const sendable = useMemo(() => selectedList.filter(hasMailableAddress), [selectedList]);
  const needsAddress = useMemo(
    () => selectedList.filter((r) => !hasMailableAddress(r)),
    [selectedList],
  );

  const selectedDesign = useMemo(
    () => designs.find((d) => d.id === selectedDesignId),
    [designs, selectedDesignId],
  );
  const personalises = selectedDesign ? hasMergeTokens(selectedDesign.document) : false;

  const perCard = CARD_MINOR + (POSTAGE_MINOR[postageClass] ?? 0);
  const estimate = perCard * sendable.length;

  function toggleRecipient(recipient: Recipient) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(recipient.id)) next.delete(recipient.id);
      else next.set(recipient.id, recipient);
      return next;
    });
  }

  function removeRecipient(id: string) {
    setSelected((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }

  function onAddressSaved(updated: Recipient) {
    setSelected((current) => {
      const next = new Map(current);
      next.set(updated.id, updated);
      return next;
    });
  }

  /** A link back to this composer's current state — used as the editor's
   * `returnTo` so a design edit round-trips without losing the selection. */
  function returnToHere(designId: string): string {
    const ids = selectedList.map((r) => r.id).join(",");
    const params = new URLSearchParams();
    if (ids) params.set("recipients", ids);
    if (designId) params.set("design", designId);
    return `/send?${params.toString()}`;
  }

  function editHref(designId: string): string {
    return `/designs/${designId}/edit?returnTo=${encodeURIComponent(returnToHere(designId))}`;
  }

  async function handleSend() {
    if (!selectedDesignId || sendable.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      // Prepare one draft order covering every sendable contact…
      const order = await clientApiFetch<BatchOrder>("/batch-orders/bulk-send", {
        method: "POST",
        body: JSON.stringify({
          savedDesignId: selectedDesignId,
          recipientIds: sendable.map((r) => r.id),
          postageClass,
        }),
      });
      // …then hand off to the same Stripe checkout every other order uses.
      const { checkoutUrl } = await clientApiFetch<{ checkoutUrl: string }>(
        `/batch-orders/${order.id}/checkout`,
        { method: "POST" },
      );
      window.location.href = checkoutUrl;
    } catch (submitError) {
      setError(
        submitError instanceof ApiError
          ? submitError.message
          : "Something went wrong — please try again.",
      );
      setBusy(false);
    }
  }

  const canPay = !busy && !!selectedDesignId && sendable.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-24 lg:pb-0">
      <div className="flex flex-col gap-1">
        <Link href="/recipients" className="text-sm text-muted hover:text-foreground">
          ← Recipients
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Send a card</h1>
        <p className="text-muted">
          The quickest way to post a card — pick who it&apos;s for, choose a design, and we print
          &amp; post each one, addressed automatically. Send to one contact or a whole group in the
          same go.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-6">
          {/* 1 — who it's going to */}
          <section className="card flex flex-col gap-4 p-6">
            <h2 className="font-semibold">1. Who to send to</h2>

            <RecipientPicker
              initialPage={initialRecipientsPage}
              lists={lists}
              selectedIds={selectedIds}
              onToggle={toggleRecipient}
            />

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  Selected: {selectedList.length} contact{selectedList.length === 1 ? "" : "s"}
                </h3>
                {selectedList.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelected(new Map())}
                    className="text-xs text-muted underline hover:text-foreground"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {needsAddress.length > 0 && (
                <div className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-accent">
                  {needsAddress.length} selected contact{needsAddress.length === 1 ? "" : "s"} still
                  {needsAddress.length === 1 ? " needs" : " need"} a UK postal address. Add one
                  below, or remove them — only contacts with an address are sent to.
                </div>
              )}

              {selectedList.length === 0 ? (
                <p className="text-sm text-muted">
                  No contacts selected yet — tick people above to add them.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {selectedList.map((recipient) => {
                    const mailable = hasMailableAddress(recipient);
                    return (
                      <li
                        key={recipient.id}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {recipient.firstName} {recipient.lastName}
                          </p>
                          {mailable ? (
                            <p className="truncate text-xs text-muted">
                              {addressSummary(recipient)}
                            </p>
                          ) : (
                            <p className="text-xs font-medium text-accent">No postal address</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setAddressModalFor(recipient)}
                            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-foreground/[0.03]"
                          >
                            {mailable ? "Edit address" : "Add address"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeRecipient(recipient.id)}
                            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-foreground/[0.03]"
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* 2 — choose the design */}
          <section className="card flex flex-col gap-3 p-6">
            <h2 className="font-semibold">2. Choose a design</h2>
            {designs.length === 0 ? (
              <p className="text-sm text-muted">
                You don&apos;t have any saved designs yet.{" "}
                <Link href="/designs" className="text-accent hover:underline">
                  Create one first
                </Link>
                .
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {designs.map((design) => {
                  const active = design.id === selectedDesignId;
                  return (
                    <div key={design.id} className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedDesignId(design.id)}
                        aria-pressed={active}
                        className={`flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors ${
                          active
                            ? "border-accent ring-1 ring-accent"
                            : "border-border hover:bg-foreground/[0.03]"
                        }`}
                      >
                        <span className="flex w-full justify-center overflow-hidden rounded-md bg-foreground/5">
                          <CardFacePreview document={design.document} width={120} />
                        </span>
                        <span className="truncate text-sm font-medium">{design.name}</span>
                      </button>
                      <Link
                        href={editHref(design.id)}
                        className="text-center text-xs text-muted hover:text-accent hover:underline"
                      >
                        Edit / personalise
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Personalisation preview — one card per recipient, with the {name}
              token resolved to each person, so the sender sees every card. */}
          {selectedDesign && sendable.length > 0 && (
            <section className="card flex flex-col gap-3 p-6">
              <div className="flex flex-col gap-1">
                <h2 className="font-semibold">Personalised for each recipient</h2>
                <p className="text-sm text-muted">
                  {personalises ? (
                    <>Each card is printed with that person&apos;s name.</>
                  ) : (
                    <>
                      This design has no{" "}
                      <code className="rounded bg-foreground/10 px-1">{"{name}"}</code> token yet —
                      add one via{" "}
                      <Link
                        href={editHref(selectedDesign.id)}
                        className="text-accent hover:underline"
                      >
                        Edit / personalise
                      </Link>{" "}
                      to include each recipient&apos;s name.
                    </>
                  )}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {sendable.slice(0, MAX_PREVIEWS).map((recipient) => (
                  <div key={recipient.id} className="flex flex-col items-center gap-1.5">
                    <CardFacePreview
                      document={applyMergeTokens(selectedDesign.document, recipient)}
                      width={150}
                    />
                    <span className="truncate text-xs text-muted">
                      {recipient.firstName} {recipient.lastName}
                    </span>
                  </div>
                ))}
              </div>
              {sendable.length > MAX_PREVIEWS && (
                <p className="text-xs text-muted">
                  …and {sendable.length - MAX_PREVIEWS} more, each with their own name.
                </p>
              )}
            </section>
          )}
        </div>

        {/* Order summary + pay */}
        <div className="card flex h-fit flex-col gap-4 p-6 lg:sticky lg:top-6">
          <h2 className="font-semibold">Order summary</h2>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Postage</legend>
            {(["second_class", "first_class"] as const).map((option) => (
              <label
                key={option}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
                  postageClass === option
                    ? "border-accent bg-accent-soft"
                    : "border-border hover:bg-foreground/[0.03]"
                }`}
              >
                <input
                  type="radio"
                  name="postage"
                  checked={postageClass === option}
                  onChange={() => setPostageClass(option)}
                  className="size-4 accent-accent"
                />
                <span className="flex-1">{POSTAGE_LABEL[option]}</span>
                <span className="font-medium text-muted">{gbp(POSTAGE_MINOR[option] ?? 0)}</span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">
                {sendable.length} card{sendable.length === 1 ? "" : "s"} × {gbp(perCard)}
              </span>
              <span>{gbp(estimate)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2 font-semibold">
              <span>Estimated total</span>
              <span>{gbp(estimate)}</span>
            </div>
          </div>

          <p className="text-xs text-muted">
            Card price includes VAT and postage per card. Any plan discount and the exact total are
            shown on the secure payment page.
          </p>

          {/* Desktop keeps the CTA in the summary column; on mobile it moves to
              the sticky bar below so the total + Pay are always in reach. */}
          <button
            type="button"
            disabled={!canPay}
            onClick={() => void handleSend()}
            className="btn-accent hidden w-full disabled:opacity-50 lg:block"
          >
            {busy
              ? "Taking you to payment…"
              : `Pay & send ${sendable.length} card${sendable.length === 1 ? "" : "s"} →`}
          </button>
          <p className="text-center text-xs text-muted">Secure payment powered by Stripe</p>
        </div>
      </div>

      {/* Sticky mobile checkout bar — total + count always visible, one tap to
          pay, instead of scrolling past the picker and design list. Respects the
          iPhone home-indicator safe area. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex flex-col leading-tight">
            <span className="text-xs text-muted">
              {sendable.length} card{sendable.length === 1 ? "" : "s"} · estimated
            </span>
            <span className="text-lg font-semibold">{gbp(estimate)}</span>
          </div>
          <button
            type="button"
            disabled={!canPay}
            onClick={() => void handleSend()}
            className="btn-accent flex-1 whitespace-nowrap disabled:opacity-50"
          >
            {busy ? "Taking you to payment…" : "Pay & send →"}
          </button>
        </div>
      </div>

      {addressModalFor && (
        <AddressModal
          recipient={addressModalFor}
          open={addressModalFor !== null}
          onClose={() => setAddressModalFor(null)}
          onSaved={onAddressSaved}
        />
      )}
    </div>
  );
}
