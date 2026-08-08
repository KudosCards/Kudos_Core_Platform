"use client";

import { Search } from "lucide-react";
import type {
  BatchOrder,
  BatchOrderPreflight,
  CardDesign,
  MessagePageSummary,
  Recipient,
  RecipientListSummary,
  SavedDesign,
  SegmentReconciliation,
} from "@kudos/shared-types";
import {
  applyMergeTokens,
  CARD_PRICE_MINOR,
  hasMergeTokens,
  hasQrElement,
  POSTAGE_MINOR as SHARED_POSTAGE_MINOR,
  ukPostcodeRegex,
} from "@kudos/shared-types";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { AddressModal } from "@/components/address-modal";
import { CardPreviewLightbox, insideFacesHint } from "@/components/card-preview-lightbox";
import { PricingBreakdownCard } from "@/components/pricing-breakdown";
import { SendTimingPicker, timingDeliverBy, type SendTiming } from "@/components/send-timing";
import { TemplatePickerModal } from "@/components/template-picker-modal";
import { PreSendCheck } from "./pre-send-check";
import { downloadContactSheet } from "./contact-sheet";
import { RecipientPicker, type Paginated } from "./recipient-picker";
import { ReviewAllCards } from "./review-all-cards";

// Client-only (Konva touches canvas APIs) — renders a card exactly as it prints.
const CardFacePreview = dynamic(
  () => import("@/components/card-face-preview").then((m) => m.CardFacePreview),
  { ssr: false },
);

/** How many personalised previews to render inline before offering "Review all". */
const MAX_PREVIEWS = 8;

/** At/above this many cards the run is large enough that reviewing every card
 * before paying really matters, so "Review all" is promoted to a primary action
 * (the scale-adaptive review threshold from ADR 0118). */
const REVIEW_ALL_THRESHOLD = 50;

/** Card price and postage in pence, for the on-screen estimate before the server
 * preflight has run. Sourced from shared-types so this never drifts from the real
 * charge; the exact, discount-applied total comes from the preflight check and
 * again from Stripe. */
const CARD_MINOR = CARD_PRICE_MINOR;
const POSTAGE_MINOR: Record<string, number> = SHARED_POSTAGE_MINOR;
const POSTAGE_LABEL: Record<string, string> = {
  second_class: "2nd class (2–3 days)",
  first_class: "1st class (next day)",
};

/** How long the run settles before the auto pre-send check fires, so a burst of
 * selection toggles makes one request, not one per click. */
const PREFLIGHT_DEBOUNCE_MS = 600;

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

/** A segment whose members seeded the selection — drives the "Sending to …"
 * heading note and a plan-cap notice. See docs/adr/0106-send-to-segment.md. */
export type SeededSegment = {
  name: string;
  /** The segment's true (uncapped) member count. */
  total: number;
  /** True when the plan's per-order cap trimmed the seeded selection. */
  capped: boolean;
  /** Per-member matched occasions for an occasion-mode segment. When present,
   * the composer offers to mark them handled so they aren't sent twice.
   * Empty for contact-mode segments. See docs/adr/0107. */
  reconciliations: SegmentReconciliation[];
};

/** Occasion-type labels for the reconcile toggle copy. */
const OCCASION_TYPE_LABEL: Record<string, string> = {
  birthday: "birthday",
  renewal: "renewal",
  anniversary: "anniversary",
  achievement: "achievement",
  leaver: "leaver",
  staff_recognition: "staff recognition",
  seasonal: "seasonal event",
  bespoke_campaign: "occasion",
};

/**
 * Bulk-send composer: pick the contacts, pick a design, fix any missing
 * addresses inline, then pay — all on one page, no dead-ends. Contacts that
 * arrive pre-selected (from the Recipients page's multi-select via `?recipients=`,
 * or a segment's members via `?segment=`) seed the selection; everything else is
 * chosen here. Editing a design hands off to the editor with a `returnTo` back to
 * this exact state.
 */
export function BulkSendClient({
  initialSelected,
  initialRecipientsPage,
  designs,
  templates,
  lists,
  initialDesignId,
  seededSegment,
  messagePages,
  canAuthorMessagePages,
}: {
  initialSelected: Recipient[];
  initialRecipientsPage: Paginated<Recipient>;
  designs: SavedDesign[];
  templates: CardDesign[];
  lists: RecipientListSummary[];
  initialDesignId: string;
  seededSegment?: SeededSegment | null;
  messagePages: MessagePageSummary[];
  canAuthorMessagePages: boolean;
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
  // Send now, or pay now and schedule delivery for a chosen date (ADR 0130).
  const [timing, setTiming] = useState<SendTiming>({ mode: "now" });
  // The "＋ New design" template chooser, and the template mid-create (so the
  // grid disables while we mint the saved design and hand off to the editor).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creatingDesignFrom, setCreatingDesignFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addressModalFor, setAddressModalFor] = useState<Recipient | null>(null);
  // The recipient whose full card (all faces) is open in the flip lightbox.
  const [previewFor, setPreviewFor] = useState<Recipient | null>(null);
  // The full-screen overlay: closed, a plain "review every card" look-through, or
  // the deliberate "review & confirm" pay gate for a large run. See ADR 0118.
  const [reviewMode, setReviewMode] = useState<null | "review" | "confirm">(null);
  // Default on: sending from an occasion-mode segment should consume the matched
  // occasion so it isn't sent again. See docs/adr/0107.
  const [markHandled, setMarkHandled] = useState(true);
  // The server-authoritative pre-send check (ADR 0118): who's ready, who needs
  // attention (address / postcode / unresolved tokens / duplicate) and the exact
  // price. Tagged with the run key it was fetched for, so a result for a stale
  // selection is ignored at render time rather than cleared via effect setState.
  const [preflightResult, setPreflightResult] = useState<{
    key: string;
    data: BatchOrderPreflight;
  } | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
  const selectedList = useMemo(() => [...selected.values()], [selected]);

  // The segment's matched occasions, keyed by recipient — used to build the
  // reconcile payload (scoped to who's actually still selected).
  const reconcileByRecipient = useMemo(
    () => new Map((seededSegment?.reconciliations ?? []).map((r) => [r.recipientId, r])),
    [seededSegment],
  );
  const sendable = useMemo(() => selectedList.filter(hasMailableAddress), [selectedList]);
  const needsAddress = useMemo(
    () => selectedList.filter((r) => !hasMailableAddress(r)),
    [selectedList],
  );

  // The segment's matched occasions among the contacts actually being sent to —
  // the reconcile set. A trimmed or manually-added contact contributes none.
  const reconcileMatches = useMemo(
    () =>
      sendable
        .map((r) => reconcileByRecipient.get(r.id))
        .filter((m): m is SegmentReconciliation => m !== undefined),
    [sendable, reconcileByRecipient],
  );
  // A noun for the toggle copy: the shared occasion type when they all match,
  // else a generic "occasion" — pluralised by how many are being consumed.
  const reconcileNoun = useMemo(() => {
    const types = [...new Set(reconcileMatches.map((m) => m.occasionType))];
    const singular =
      types.length === 1 ? (OCCASION_TYPE_LABEL[types[0]!] ?? "occasion") : "occasion";
    return `${singular}${reconcileMatches.length === 1 ? "" : "s"}`;
  }, [reconcileMatches]);

  const selectedDesign = useMemo(
    () => designs.find((d) => d.id === selectedDesignId),
    [designs, selectedDesignId],
  );
  const personalises = selectedDesign ? hasMergeTokens(selectedDesign.document) : false;
  // The "add a message page?" step only appears when the chosen design carries a
  // QR element to point at it (ADR 0132).
  const designHasQr = selectedDesign ? hasQrElement(selectedDesign.document) : false;
  const [messagePageId, setMessagePageId] = useState<string>("");
  const activeMessagePages = useMemo(
    () => messagePages.filter((page) => page.status === "active"),
    [messagePages],
  );

  const perCard = CARD_MINOR + (POSTAGE_MINOR[postageClass] ?? 0);
  const estimate = perCard * sendable.length;

  // Everything the preflight depends on, flattened to a stable string so the check
  // re-runs when the design, postage, the selected set, OR an inline address fix
  // changes — but not on unrelated re-renders.
  const preflightKey = useMemo(
    () =>
      JSON.stringify({
        d: selectedDesignId,
        p: postageClass,
        r: selectedList
          .map((r) =>
            [r.id, r.addressLine1, r.addressCity, r.addressPostcode, r.addressCountry].join("|"),
          )
          .sort(),
      }),
    [selectedDesignId, postageClass, selectedList],
  );

  // Auto pre-send check: debounced, and guarded by a sequence number so a slow
  // response for a stale selection can never overwrite a newer one. All setState
  // happens inside the debounced callback (never synchronously in the effect
  // body); a stale result is discarded at render time via the key tag.
  const preflightSeq = useRef(0);
  useEffect(() => {
    if (!selectedDesignId || selectedList.length === 0) return;
    const seq = ++preflightSeq.current;
    const key = preflightKey;
    const recipientIds = selectedList.map((r) => r.id);
    const timer = setTimeout(() => {
      setPreflightBusy(true);
      void (async () => {
        try {
          const data = await clientApiFetch<BatchOrderPreflight>("/batch-orders/preflight", {
            method: "POST",
            body: JSON.stringify({ savedDesignId: selectedDesignId, recipientIds, postageClass }),
          });
          if (seq !== preflightSeq.current) return;
          setPreflightResult({ key, data });
          setPreflightError(null);
        } catch {
          if (seq !== preflightSeq.current) return;
          setPreflightError("Couldn't run the pre-send check just now.");
        } finally {
          if (seq === preflightSeq.current) setPreflightBusy(false);
        }
      })();
    }, PREFLIGHT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // preflightKey captures every input the request cares about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preflightKey]);

  // Only trust a result fetched for the *current* run; a stale one (selection
  // changed since) reads as "no check yet" until the fresh fetch lands.
  const preflight = preflightResult?.key === preflightKey ? preflightResult.data : null;

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

  /** Open the address editor for a recipient flagged by the pre-send check (the
   * contact is always in the current selection, so this is a cheap lookup). */
  function fixAddressFor(recipientId: string) {
    const recipient = selected.get(recipientId);
    if (recipient) setAddressModalFor(recipient);
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

  /** "＋ New design": copy a catalog template into a fresh saved design, then open
   * it in the editor carrying a `returnTo` back here — so a buyer can create a
   * card mid-order and land back on this page with it selected and their
   * contacts intact, closing the design→pay loop. */
  async function createDesignFromTemplate(template: CardDesign) {
    setError(null);
    setCreatingDesignFrom(template.id);
    try {
      const created = await clientApiFetch<SavedDesign>("/saved-designs", {
        method: "POST",
        body: JSON.stringify({ cardDesignId: template.id, name: `${template.name} copy` }),
      });
      // Full navigation into the editor; its "Save & return" brings the buyer
      // back to returnToHere(created.id) with the new design pre-selected.
      window.location.assign(editHref(created.id));
    } catch (submitError) {
      setError(
        submitError instanceof ApiError ? submitError.message : "Could not start a new design.",
      );
      setCreatingDesignFrom(null);
    }
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
          // Attach the chosen message page to every card's QR (only meaningful
          // when the design carries a QR element). See docs/adr/0132.
          messagePageId: designHasQr && messagePageId ? messagePageId : undefined,
          // Undefined for "send now"; an arrive-by date for a scheduled send.
          deliverBy: timingDeliverBy(timing),
          // Consume the matched natural occasions (unless the sender opted out),
          // so they aren't sent a second time. See docs/adr/0107.
          reconcile:
            markHandled && reconcileMatches.length > 0
              ? reconcileMatches.map((m) => ({
                  recipientId: m.recipientId,
                  occasionId: m.occasionId,
                }))
              : undefined,
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
  // Scale-adaptive routing (ADR 0118): a large run pays through the deliberate
  // "Review & confirm" gate; a small run keeps the frictionless one-tap pay.
  const largeRun = sendable.length >= REVIEW_ALL_THRESHOLD;
  const cardNoun = `${sendable.length} card${sendable.length === 1 ? "" : "s"}`;
  const payVerb = timing.mode === "scheduled" ? "schedule" : "send";
  const primaryCtaLabel = largeRun
    ? `Review & confirm ${sendable.length} cards →`
    : busy
      ? "Taking you to payment…"
      : `Pay & ${payVerb} ${cardNoun} →`;
  /** The main CTA: large runs open the gate; small runs pay straight away. */
  function onPrimaryCta() {
    if (largeRun) setReviewMode("confirm");
    else void handleSend();
  }

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

      {seededSegment && (
        <div className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <p className="font-medium text-accent">
            Sending to <span className="font-semibold">{seededSegment.name}</span> —{" "}
            {seededSegment.total} contact{seededSegment.total === 1 ? "" : "s"}.
          </p>
          {seededSegment.capped ? (
            <p className="mt-0.5 text-muted">
              Your plan sends up to {selectedList.length} per order, so we&apos;ve added the first{" "}
              {selectedList.length}. Remove anyone below, or send the rest in a second order.
            </p>
          ) : (
            <p className="mt-0.5 text-muted">
              Everyone&apos;s pre-selected below — remove anyone you don&apos;t want, fix any
              missing addresses, then choose a design and pay.
            </p>
          )}

          {/* Occasion-mode segments: offer to consume the matched occasion so it
              isn't also sent from approvals/auto-send. See docs/adr/0107. */}
          {reconcileMatches.length > 0 && (
            <label className="mt-3 flex items-start gap-2.5 border-t border-accent/20 pt-3 text-muted">
              <input
                type="checkbox"
                checked={markHandled}
                onChange={(e) => setMarkHandled(e.target.checked)}
                className="mt-0.5 size-4 accent-accent"
              />
              <span>
                Mark {reconcileMatches.length === 1 ? "this" : "these"} {reconcileNoun} as handled
                so
                {reconcileMatches.length === 1 ? " it isn't" : " they aren't"} sent again from your
                approvals or auto-send.
              </span>
            </label>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">2. Choose a design</h2>
              {templates.length > 0 && designs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  ＋ New design
                </button>
              )}
            </div>
            {designs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted">You don&apos;t have any saved designs yet.</p>
                {templates.length > 0 ? (
                  <button type="button" onClick={() => setPickerOpen(true)} className="btn-accent">
                    ＋ Start a new design
                  </button>
                ) : (
                  <Link href="/designs" className="text-accent hover:underline">
                    Create one first
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {/* Create a fresh design without leaving the order — the buyer
                    lands back here with it selected once they save. */}
                {templates.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="flex min-h-[9.5rem] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2 text-muted transition-colors hover:border-accent hover:text-accent"
                  >
                    <span className="text-2xl leading-none">＋</span>
                    <span className="text-xs font-medium">New design</span>
                  </button>
                )}
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
                        className="rounded-md border border-border px-2 py-1 text-center text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
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
              token resolved to each person. Each tile opens a flip lightbox
              showing every face (front + inside + back) alongside the exact
              address it posts to, so the sender reviews the whole card, not just
              the cover, before paying. */}
          {selectedDesign && sendable.length > 0 && (
            <section className="card flex flex-col gap-3 p-6">
              <div className="flex flex-col gap-1">
                <h2 className="font-semibold">Personalised for each recipient</h2>
                <p className="text-sm text-muted">
                  {personalises ? (
                    <>Each card is printed with that person&apos;s name. </>
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
                      to include each recipient&apos;s name.{" "}
                    </>
                  )}
                  Click any card to flip through every face and check the address.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {sendable.slice(0, MAX_PREVIEWS).map((recipient) => {
                  const merged = applyMergeTokens(selectedDesign.document, recipient);
                  const insideHint = insideFacesHint(merged);
                  return (
                    <button
                      key={recipient.id}
                      type="button"
                      onClick={() => setPreviewFor(recipient)}
                      className="group flex flex-col items-center gap-1.5 rounded-lg p-1 text-center transition-colors hover:bg-foreground/[0.03]"
                    >
                      <span className="relative">
                        <CardFacePreview document={merged} width={150} />
                        {insideHint && (
                          <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            {insideHint}
                          </span>
                        )}
                      </span>
                      <span className="truncate text-xs text-muted group-hover:text-foreground">
                        {recipient.firstName} {recipient.lastName}
                      </span>
                    </button>
                  );
                })}
              </div>
              {sendable.length > MAX_PREVIEWS && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <p className="text-xs text-muted">
                    …and {sendable.length - MAX_PREVIEWS} more, each with their own name.
                  </p>
                  <button
                    type="button"
                    onClick={() => setReviewMode("review")}
                    className={
                      sendable.length >= REVIEW_ALL_THRESHOLD
                        ? "btn-accent text-sm"
                        : "rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-foreground/[0.04]"
                    }
                  >
                    <Search className="mr-1.5 inline h-4 w-4 align-text-bottom" aria-hidden /> Review
                    all {sendable.length} cards
                  </button>
                </div>
              )}
              {sendable.length >= REVIEW_ALL_THRESHOLD && (
                <p className="text-xs text-muted">
                  Sending a large run? Open{" "}
                  <button
                    type="button"
                    onClick={() => setReviewMode("review")}
                    className="text-accent underline hover:no-underline"
                  >
                    Review all {sendable.length} cards
                  </button>{" "}
                  to search and check every personalised card before you pay.
                </p>
              )}
            </section>
          )}

          {/* Server-authoritative pre-send check: who's ready, who needs
              attention (with inline address fixes), refreshed as the run
              changes. See docs/adr/0118. */}
          {selectedDesign && selectedList.length > 0 && (
            <PreSendCheck
              preflight={preflight}
              busy={preflightBusy}
              error={preflightError}
              editDesignHref={editHref(selectedDesign.id)}
              onFixAddress={fixAddressFor}
            />
          )}
        </div>

        {/* Order summary + pay */}
        <div className="card flex h-fit min-w-0 flex-col gap-4 p-6 lg:sticky lg:top-6">
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

          {designHasQr && (
            <fieldset className="flex flex-col gap-2 border-t border-border pt-3">
              <legend className="mb-1 text-sm font-medium">Message page</legend>
              <p className="text-xs text-muted">
                This design has a QR code. Attach a message page so recipients see a video
                and a personal note when they scan it.
              </p>
              {activeMessagePages.length > 0 ? (
                <select
                  value={messagePageId}
                  onChange={(e) => setMessagePageId(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-base sm:text-sm"
                >
                  <option value="">No message page</option>
                  {activeMessagePages.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.emoji ? `${page.emoji} ` : ""}
                      {page.title}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted">
                  {canAuthorMessagePages ? (
                    <Link href="/message-pages/new" className="text-accent hover:underline">
                      Create a message page
                    </Link>
                  ) : (
                    <Link href="/billing" className="text-accent hover:underline">
                      Upgrade to add message pages
                    </Link>
                  )}{" "}
                  to use this card&apos;s QR code.
                </p>
              )}
            </fieldset>
          )}

          <div className="border-t border-border pt-3">
            {preflight ? (
              // The server preflight returns the exact, discount-applied, VAT-
              // decomposed price for the cards that will actually be charged.
              <PricingBreakdownCard breakdown={preflight.price} />
            ) : (
              <div className="flex flex-col gap-2 text-sm">
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
            )}
          </div>

          <p className="text-xs text-muted">
            {preflight
              ? "This is the exact amount, with any plan discount applied — confirmed again on the secure payment page."
              : "Card price includes VAT and postage per card. Any plan discount and the exact total are shown on the secure payment page."}
          </p>

          <div className="border-t border-border pt-3">
            <SendTimingPicker postageClass={postageClass} value={timing} onChange={setTiming} />
          </div>

          {/* Desktop keeps the CTA in the summary column; on mobile it moves to
              the sticky bar below so the total + Pay are always in reach. */}
          {selectedDesign && sendable.length > 0 && (
            <button
              type="button"
              onClick={() =>
                downloadContactSheet(selectedDesign, sendable, {
                  postageLabel: POSTAGE_LABEL[postageClass] ?? "Standard postage",
                  totalLabel: preflight ? gbp(preflight.price.totalMinor) : undefined,
                })
              }
              className="hidden text-xs text-muted underline hover:text-foreground lg:block"
            >
              ⬇ Download proof sheet (every card, address &amp; message)
            </button>
          )}

          <button
            type="button"
            disabled={!canPay}
            onClick={onPrimaryCta}
            className="btn-accent hidden w-full disabled:opacity-50 lg:block"
          >
            {primaryCtaLabel}
          </button>
          <p className="text-center text-xs text-muted">
            {largeRun
              ? "You'll see every card and confirm before paying · Secure payment by Stripe"
              : "Secure payment powered by Stripe"}
          </p>
        </div>
      </div>

      {/* Sticky mobile checkout bar — total + count always visible, one tap to
          pay, instead of scrolling past the picker and design list. Respects the
          iPhone home-indicator safe area. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex flex-col leading-tight">
            <span className="text-xs text-muted">
              {(preflight ? preflight.price.cardCount : sendable.length)} card
              {(preflight ? preflight.price.cardCount : sendable.length) === 1 ? "" : "s"} ·{" "}
              {preflight ? "total" : "estimated"}
            </span>
            <span className="text-lg font-semibold">
              {gbp(preflight ? preflight.price.totalMinor : estimate)}
            </span>
          </div>
          <button
            type="button"
            disabled={!canPay}
            onClick={onPrimaryCta}
            className="btn-accent flex-1 whitespace-nowrap disabled:opacity-50"
          >
            {largeRun
              ? "Review & confirm →"
              : busy
                ? "Taking you to payment…"
                : `Pay & ${payVerb} →`}
          </button>
        </div>
      </div>

      <TemplatePickerModal
        templates={templates}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(template) => void createDesignFromTemplate(template)}
        busyTemplateId={creatingDesignFrom}
      />

      {addressModalFor && (
        <AddressModal
          recipient={addressModalFor}
          open={addressModalFor !== null}
          onClose={() => setAddressModalFor(null)}
          onSaved={onAddressSaved}
        />
      )}

      {previewFor && selectedDesign && (
        <CardPreviewLightbox
          document={applyMergeTokens(selectedDesign.document, previewFor)}
          title={`${previewFor.firstName} ${previewFor.lastName}`}
          subtitle={addressSummary(previewFor)}
          onClose={() => setPreviewFor(null)}
        />
      )}

      {reviewMode && selectedDesign && (
        <ReviewAllCards
          design={selectedDesign}
          recipients={sendable}
          onClose={() => setReviewMode(null)}
          postageLabel={POSTAGE_LABEL[postageClass] ?? "Standard postage"}
          confirm={
            reviewMode === "confirm"
              ? { preflight, paying: busy, onPay: () => void handleSend() }
              : undefined
          }
        />
      )}
    </div>
  );
}
