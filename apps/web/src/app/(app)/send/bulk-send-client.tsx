"use client";

import type { BatchOrder, Recipient, SavedDesign } from "@kudos/shared-types";
import { applyMergeTokens, hasMergeTokens, ukPostcodeRegex } from "@kudos/shared-types";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

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

export function BulkSendClient({
  recipients: initialRecipients,
  designs,
}: {
  recipients: Recipient[];
  designs: SavedDesign[];
}) {
  const [recipients, setRecipients] = useState(initialRecipients);
  const [selectedDesignId, setSelectedDesignId] = useState<string>(designs[0]?.id ?? "");
  const [postageClass, setPostageClass] = useState<"second_class" | "first_class">("second_class");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendable = useMemo(() => recipients.filter(hasMailableAddress), [recipients]);
  const needsAddress = useMemo(() => recipients.filter((r) => !hasMailableAddress(r)), [recipients]);

  const selectedDesign = useMemo(
    () => designs.find((d) => d.id === selectedDesignId),
    [designs, selectedDesignId],
  );
  // Whether the chosen design carries a {name}-style token, so each card comes
  // out personalised. Drives the preview copy below.
  const personalises = selectedDesign ? hasMergeTokens(selectedDesign.document) : false;

  const perCard = CARD_MINOR + (POSTAGE_MINOR[postageClass] ?? 0);
  const estimate = perCard * sendable.length;

  function removeRecipient(id: string) {
    setRecipients((current) => current.filter((r) => r.id !== id));
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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/recipients" className="text-sm text-muted hover:text-foreground">
          ← Back to recipients
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Bulk send</h1>
        <p className="text-muted">
          Pick one design and we&apos;ll print &amp; post it to every selected contact — each
          addressed automatically from their record.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          {/* 1 — choose the design */}
          <section className="card flex flex-col gap-3 p-6">
            <h2 className="font-semibold">1. Choose a design</h2>
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
                    <button
                      key={design.id}
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
                      This design has no <code className="rounded bg-foreground/10 px-1">{"{name}"}</code>{" "}
                      token yet — add one in the{" "}
                      <Link href={`/designs/${selectedDesign.id}/edit`} className="text-accent hover:underline">
                        editor
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

          {/* 2 — who it's going to */}
          <section className="card flex flex-col gap-3 p-6">
            <h2 className="font-semibold">
              2. Sending to {sendable.length} contact{sendable.length === 1 ? "" : "s"}
            </h2>

            {needsAddress.length > 0 && (
              <div className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-accent">
                {needsAddress.length} contact{needsAddress.length === 1 ? " needs" : "s need"} a full
                UK postal address before they can be sent to. Add an address, or remove them below.
              </div>
            )}

            <ul className="flex flex-col divide-y divide-border">
              {recipients.length === 0 && (
                <li className="py-3 text-sm text-muted">No contacts selected.</li>
              )}
              {recipients.map((recipient) => {
                const mailable = hasMailableAddress(recipient);
                return (
                  <li key={recipient.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {recipient.firstName} {recipient.lastName}
                      </p>
                      {mailable ? (
                        <p className="truncate text-xs text-muted">{addressSummary(recipient)}</p>
                      ) : (
                        <p className="text-xs font-medium text-accent">
                          No postal address —{" "}
                          <Link href={`/recipients/${recipient.id}`} className="underline">
                            add one
                          </Link>
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRecipient(recipient.id)}
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-foreground/[0.03]"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* Order summary + pay */}
        <div className="card flex h-fit flex-col gap-4 p-6">
          <h2 className="font-semibold">Order summary</h2>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Postage</legend>
            {(["second_class", "first_class"] as const).map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="postage"
                  checked={postageClass === option}
                  onChange={() => setPostageClass(option)}
                />
                <span>{POSTAGE_LABEL[option]}</span>
                <span className="text-muted">{gbp(POSTAGE_MINOR[option] ?? 0)}</span>
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

          <button
            type="button"
            disabled={busy || !selectedDesignId || sendable.length === 0}
            onClick={() => void handleSend()}
            className="btn-accent w-full disabled:opacity-50"
          >
            {busy
              ? "Taking you to payment…"
              : `Pay & send ${sendable.length} card${sendable.length === 1 ? "" : "s"} →`}
          </button>
          <p className="text-center text-xs text-muted">Secure payment powered by Stripe</p>
        </div>
      </div>
    </div>
  );
}
