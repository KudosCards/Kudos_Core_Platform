"use client";

import type { BatchOrder, DesignDocument, MessagePageSummary } from "@kudos/shared-types";
import { hasQrElement, linkedMessagePageId } from "@kudos/shared-types";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { SendTimingPicker, timingDeliverBy, type SendTiming } from "@/components/send-timing";

/** Card price and postage in pence, for the on-screen estimate. The server is
 * authoritative — Stripe shows the exact total, and plan discounts (Pro/Centre)
 * are applied there — so this is labelled an estimate. Mirrors the marketing
 * page's headline pricing. */
const CARD_MINOR = 150;
const POSTAGE_MINOR: Record<string, number> = { second_class: 91, first_class: 180 };
const POSTAGE_LABEL: Record<string, string> = {
  second_class: "2nd class (2–3 days)",
  first_class: "1st class (next day)",
};

function gbp(minor: number): string {
  return `£${(minor / 100).toFixed(2)}`;
}

/** The slice of a contact the address-book search needs to prefill a send. */
interface ContactResult {
  id: string;
  firstName: string;
  lastName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressPostcode: string | null;
}

interface AddressForm {
  firstName: string;
  lastName: string;
  shippingAddressLine1: string;
  shippingAddressLine2: string;
  shippingAddressCity: string;
  shippingAddressPostcode: string;
}

const EMPTY_FORM: AddressForm = {
  firstName: "",
  lastName: "",
  shippingAddressLine1: "",
  shippingAddressLine2: "",
  shippingAddressCity: "",
  shippingAddressPostcode: "",
};

function formFromContact(c: ContactResult): AddressForm {
  return {
    firstName: c.firstName,
    lastName: c.lastName,
    shippingAddressLine1: c.addressLine1 ?? "",
    shippingAddressLine2: c.addressLine2 ?? "",
    shippingAddressCity: c.addressCity ?? "",
    shippingAddressPostcode: c.addressPostcode ?? "",
  };
}

/** One-line address preview for a search result row. */
function addressPreview(c: ContactResult): string {
  return (
    [c.addressLine1, c.addressCity, c.addressPostcode].filter(Boolean).join(", ") ||
    "No address on file"
  );
}

export function SendCardClient({
  designId,
  designName,
  designDocument,
  messagePages,
  canAuthorMessagePages,
}: {
  designId: string;
  designName: string;
  designDocument: DesignDocument;
  messagePages: MessagePageSummary[];
  canAuthorMessagePages: boolean;
}) {
  const [postageClass, setPostageClass] = useState<"second_class" | "first_class">("second_class");
  // Send now, or pay now and schedule delivery for a chosen date (ADR 0130).
  // Unselected by default — the sender must actively choose the timing before
  // paying, so nothing goes out on a default (ADR 0159).
  const [timing, setTiming] = useState<SendTiming | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Offer a message page only when the design carries a QR element to point it
  // at — mirroring the bulk composer (ADR 0132). The endpoint already accepts
  // messagePageId; at settlement each card's QR link is minted onto the page.
  const designHasQr = hasQrElement(designDocument);
  const activeMessagePages = useMemo(
    () => messagePages.filter((page) => page.status === "active"),
    [messagePages],
  );
  // Default to the page linked in the designer (ADR 0137) so the customer
  // doesn't re-pick what they already chose — but only if it's still an active
  // page, else fall back to "no page" and let them choose.
  const designLinkedPageId = linkedMessagePageId(designDocument);
  const [messagePageId, setMessagePageId] = useState<string>(() =>
    designLinkedPageId && activeMessagePages.some((page) => page.id === designLinkedPageId)
      ? designLinkedPageId
      : "",
  );

  // Address-book search. `selectedContactId` set → we're sending to an existing
  // contact (reuse it, no new record); null → adding a new contact.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [form, setForm] = useState<AddressForm>(EMPTY_FORM);
  const [saveToContacts, setSaveToContacts] = useState(true);

  function patch(next: Partial<AddressForm>) {
    setForm((current) => ({ ...current, ...next }));
  }

  // Debounced typeahead against the existing GET /recipients?search= endpoint.
  // Only runs while adding a new contact (no selection) and with 2+ characters.
  // All state updates live inside the timeout so none run synchronously in the
  // effect body (which would risk cascading renders).
  useEffect(() => {
    const q = query.trim();
    const active = !selectedContactId && q.length >= 2;
    const handle = setTimeout(
      () => {
        if (!active) {
          setResults([]);
          setSearching(false);
          return;
        }
        setSearching(true);
        void (async () => {
          try {
            const data = await clientApiFetch<{ items: ContactResult[] }>(
              `/recipients?search=${encodeURIComponent(q)}&perPage=6`,
            );
            setResults(data.items);
            setShowResults(true);
          } catch {
            setResults([]);
          } finally {
            setSearching(false);
          }
        })();
      },
      active ? 250 : 0,
    );
    return () => clearTimeout(handle);
  }, [query, selectedContactId]);

  function selectContact(contact: ContactResult) {
    setSelectedContactId(contact.id);
    setForm(formFromContact(contact));
    setQuery("");
    setResults([]);
    setShowResults(false);
  }

  function clearContact() {
    // Back to "new contact": keep the typed values so nothing is lost, but the
    // send will now create a contact rather than reuse one.
    setSelectedContactId(null);
  }

  const estimate = CARD_MINOR + (POSTAGE_MINOR[postageClass] ?? 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!timing) {
      setError("Please choose when to send — Send now or Schedule delivery.");
      return;
    }
    const trimmed: AddressForm = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      shippingAddressLine1: form.shippingAddressLine1.trim(),
      shippingAddressLine2: form.shippingAddressLine2.trim(),
      shippingAddressCity: form.shippingAddressCity.trim(),
      shippingAddressPostcode: form.shippingAddressPostcode.trim(),
    };

    setBusy(true);
    try {
      // Prepare the order (recipient + approved occasion + draft order)…
      const order = await clientApiFetch<BatchOrder>("/batch-orders/quick-send", {
        method: "POST",
        body: JSON.stringify({
          savedDesignId: designId,
          firstName: trimmed.firstName,
          lastName: trimmed.lastName,
          shippingAddressLine1: trimmed.shippingAddressLine1,
          ...(trimmed.shippingAddressLine2 && {
            shippingAddressLine2: trimmed.shippingAddressLine2,
          }),
          shippingAddressCity: trimmed.shippingAddressCity,
          shippingAddressPostcode: trimmed.shippingAddressPostcode,
          postageClass,
          // Undefined for "send now"; an arrive-by date for a scheduled send.
          deliverBy: timingDeliverBy(timing),
          // Attach the chosen message page to this card's QR — only meaningful
          // when the design carries a QR element (ADR 0132).
          ...(designHasQr && messagePageId ? { messagePageId } : {}),
          // Existing contact → reuse it; new contact → maybe save it.
          ...(selectedContactId ? { recipientId: selectedContactId } : { saveToContacts }),
        }),
      });

      // …then hand off to the same Stripe checkout the manual flow uses.
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

  // text-base on mobile (16px) stops iOS Safari zooming in when a field is
  // focused; text-sm keeps it tidy on desktop. py-2.5 gives a comfier tap target.
  const inputClass = "rounded-md border border-border bg-surface px-3 py-2.5 text-base sm:text-sm";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-24 lg:pb-0">
      <div className="flex flex-col gap-1">
        <Link
          href={`/designs/${designId}/edit`}
          className="text-sm text-muted hover:text-foreground"
        >
          ← Back to editing
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Send your card</h1>
        <p className="text-muted">
          Tell us who it’s for and we’ll print & post a real card to their door.
        </p>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

      <form
        id="send-card-form"
        onSubmit={(event) => void handleSubmit(event)}
        className="grid gap-6 lg:grid-cols-[1.4fr_1fr]"
      >
        <div className="card flex flex-col gap-4 p-6">
          <h2 className="font-semibold">Who’s this card for?</h2>

          {selectedContactId ? (
            // Sending to a saved contact — show who, with a way back to search.
            <div className="flex items-center justify-between gap-3 rounded-lg border border-accent bg-accent-soft px-4 py-3">
              <div className="flex flex-col">
                <span className="text-sm font-semibold">
                  {form.firstName} {form.lastName}
                </span>
                <span className="text-xs text-muted">
                  From your contacts · address prefilled below (editable)
                </span>
              </div>
              <button
                type="button"
                onClick={clearContact}
                className="text-xs font-medium text-accent underline-offset-2 hover:underline"
              >
                Change
              </button>
            </div>
          ) : (
            // New contact — offer address-book search first so an existing
            // contact isn't re-typed (and duplicated).
            <ContactSearch
              query={query}
              setQuery={setQuery}
              results={results}
              searching={searching}
              showResults={showResults}
              setShowResults={setShowResults}
              onSelect={selectContact}
              inputClass={inputClass}
            />
          )}

          {/* autoComplete lets the phone one-tap-autofill a saved address; the
              per-field capitalisation gives the right mobile keyboard/case. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">First name</span>
              <input
                value={form.firstName}
                onChange={(e) => patch({ firstName: e.target.value })}
                required
                autoComplete="given-name"
                autoCapitalize="words"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Last name</span>
              <input
                value={form.lastName}
                onChange={(e) => patch({ lastName: e.target.value })}
                required
                autoComplete="family-name"
                autoCapitalize="words"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-muted">Address line 1</span>
              <input
                value={form.shippingAddressLine1}
                onChange={(e) => patch({ shippingAddressLine1: e.target.value })}
                required
                autoComplete="address-line1"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-muted">Address line 2 (optional)</span>
              <input
                value={form.shippingAddressLine2}
                onChange={(e) => patch({ shippingAddressLine2: e.target.value })}
                autoComplete="address-line2"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Town / city</span>
              <input
                value={form.shippingAddressCity}
                onChange={(e) => patch({ shippingAddressCity: e.target.value })}
                required
                autoComplete="address-level2"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Postcode</span>
              <input
                value={form.shippingAddressPostcode}
                onChange={(e) => patch({ shippingAddressPostcode: e.target.value })}
                required
                autoComplete="postal-code"
                autoCapitalize="characters"
                className={inputClass}
              />
            </label>
          </div>

          {/* Only offered for a NEW contact — an existing one is already saved. */}
          {!selectedContactId && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={saveToContacts}
                onChange={(e) => setSaveToContacts(e.target.checked)}
                className="mt-0.5 size-4 accent-accent"
              />
              <span>
                Save to my contacts
                <span className="block text-xs text-muted">
                  Keep this person in your address book for next time. Uncheck for a one-off send.
                </span>
              </span>
            </label>
          )}

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
            <fieldset className="flex flex-col gap-2 border-t border-border pt-4">
              <legend className="mb-1 text-sm font-medium">Message page</legend>
              <p className="text-xs text-muted">
                This design has a QR code. Attach a message page so they see a video and a personal
                note when they scan it.
              </p>
              {activeMessagePages.length > 0 ? (
                <>
                  <select
                    value={messagePageId}
                    onChange={(e) => setMessagePageId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">No message page</option>
                    {activeMessagePages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.emoji ? `${page.emoji} ` : ""}
                        {page.title}
                      </option>
                    ))}
                  </select>
                  {designLinkedPageId && messagePageId === designLinkedPageId && (
                    <p className="text-xs text-muted">Pre-filled from your card design.</p>
                  )}
                </>
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
                  to use this card’s QR code.
                </p>
              )}
            </fieldset>
          )}
        </div>

        <div className="card flex h-fit flex-col gap-4 p-6">
          <h2 className="font-semibold">Order summary</h2>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">{designName}</span>
              <span>{gbp(CARD_MINOR)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Postage — {POSTAGE_LABEL[postageClass]}</span>
              <span>{gbp(POSTAGE_MINOR[postageClass] ?? 0)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-border pt-2 font-semibold">
              <span>Estimated total</span>
              <span>{gbp(estimate)}</span>
            </div>
          </div>
          <p className="text-xs text-muted">
            Card price includes VAT. Any plan discount and the exact total are shown on the secure
            payment page.
          </p>
          <div className="border-t border-border pt-3">
            <SendTimingPicker postageClass={postageClass} value={timing} onChange={setTiming} />
            {timing === null && (
              <p className="mt-2 text-xs text-muted">Choose when to send to continue.</p>
            )}
          </div>
          {/* Desktop keeps the CTA in the summary column; on mobile it moves to
              the sticky bar below so the total + Pay are always in reach. */}
          <button
            type="submit"
            disabled={busy || !timing}
            className="btn-accent hidden w-full disabled:opacity-50 lg:block"
          >
            {busy
              ? "Taking you to payment…"
              : `Pay & ${timing?.mode === "scheduled" ? "schedule" : "send"} →`}
          </button>
          <p className="text-center text-xs text-muted">Secure payment powered by Stripe</p>
        </div>
      </form>

      {/* Sticky mobile checkout bar — total always visible, one-tap to pay,
          instead of scrolling past the whole form. Pays via the form id, and
          respects the iPhone home-indicator safe area. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div className="flex flex-col leading-tight">
            <span className="text-xs text-muted">Estimated total</span>
            <span className="text-lg font-semibold">{gbp(estimate)}</span>
          </div>
          <button
            type="submit"
            form="send-card-form"
            disabled={busy || !timing}
            className="btn-accent flex-1 whitespace-nowrap disabled:opacity-50"
          >
            {busy
              ? "Taking you to payment…"
              : `Pay & ${timing?.mode === "scheduled" ? "schedule" : "send"} →`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Address-book typeahead: search existing contacts by name and pick one to
 * prefill the send, so a contact already on file is never re-typed. */
function ContactSearch({
  query,
  setQuery,
  results,
  searching,
  showResults,
  setShowResults,
  onSelect,
  inputClass,
}: {
  query: string;
  setQuery: (value: string) => void;
  results: ContactResult[];
  searching: boolean;
  showResults: boolean;
  setShowResults: (value: boolean) => void;
  onSelect: (contact: ContactResult) => void;
  inputClass: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking away, so it doesn't hover over the form.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [setShowResults]);

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Find a contact</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          placeholder="Search your address book by name…"
          className={inputClass}
        />
      </label>
      <p className="text-xs text-muted">
        Or just fill in the details below to send to someone new.
      </p>

      {showResults && (query.trim().length >= 2 || searching) && (
        <div className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          {searching && results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">
              No contacts match — fill in the details below to send to someone new.
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {results.map((contact) => (
                <li key={contact.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(contact)}
                    className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left hover:bg-accent-soft"
                  >
                    <span className="text-sm font-medium">
                      {contact.firstName} {contact.lastName}
                    </span>
                    <span className="text-xs text-muted">{addressPreview(contact)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
