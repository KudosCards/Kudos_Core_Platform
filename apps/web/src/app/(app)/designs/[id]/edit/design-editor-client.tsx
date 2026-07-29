"use client";

import type {
  DesignAsset,
  DesignDocument,
  DesignElement,
  DesignPage,
  SavedDesign,
} from "@kudos/shared-types";
import {
  CARD_WIDTH,
  MERGE_FIELDS,
  findDesignBracketTokenMistakes,
  fixDesignBracketTokens,
} from "@kudos/shared-types";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { createClient } from "@/lib/supabase/client";

const DesignCanvas = dynamic(() => import("./design-canvas").then((mod) => mod.DesignCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-[3/4] w-full max-w-[640px] items-center justify-center rounded-md border border-black/10 text-sm text-foreground/50 dark:border-white/10">
      Loading canvas…
    </div>
  ),
});

const PAGE_NAMES: DesignPage["name"][] = ["front", "inside-left", "inside-right", "back"];
const FONT_OPTIONS = ["Georgia", "Helvetica", "Times New Roman", "Courier New"];

/** Longest side (in design units) a freshly-inserted image is scaled to fit. */
const IMAGE_INSERT_MAX = 200;

interface SignedUpload {
  path: string;
  token: string;
  publicUrl: string;
}

/** Read an image file's natural pixel dimensions in the browser. Falls back to
 * a square if the browser can't decode it, so an insert never hard-fails. */
function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: img.naturalWidth || IMAGE_INSERT_MAX,
        height: img.naturalHeight || IMAGE_INSERT_MAX,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: IMAGE_INSERT_MAX, height: IMAGE_INSERT_MAX });
    };
    img.src = url;
  });
}

/** Scale a natural size down to fit within a square box while preserving its
 * aspect ratio (never upscales past the box on its longest side). */
function fitWithinBox(
  size: { width: number; height: number },
  maxSide: number,
): { width: number; height: number } {
  const longest = Math.max(size.width, size.height);
  const factor = longest > maxSide ? maxSide / longest : 1;
  return {
    width: Math.max(1, Math.round(size.width * factor)),
    height: Math.max(1, Math.round(size.height * factor)),
  };
}

function newTextElement(): Extract<DesignElement, { kind: "text" }> {
  return {
    kind: "text",
    id: crypto.randomUUID(),
    text: "New text",
    x: 40,
    y: 40,
    fontFamily: "Helvetica",
    fontSize: 20,
    color: "#111111",
  };
}

function newQrElement(): Extract<DesignElement, { kind: "qr" }> {
  return {
    kind: "qr",
    id: crypto.randomUUID(),
    x: 40,
    y: 40,
    size: 120,
    rotation: 0,
  };
}

export function DesignEditorClient({
  savedDesign,
  returnTo,
}: {
  savedDesign: SavedDesign;
  returnTo?: string;
}) {
  // Only honour an in-app bulk-send return target — never an arbitrary URL
  // (guards against an open redirect via the ?returnTo param).
  const bulkReturnTo = returnTo && returnTo.startsWith("/send") ? returnTo : null;
  const [name, setName] = useState(savedDesign.name);
  const [document_, setDocument] = useState<DesignDocument>(savedDesign.document);
  const [activePage, setActivePage] = useState<DesignPage["name"]>("front");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // When on (the default), resizing an image keeps its aspect ratio so it can't
  // be stretched out of shape; turn it off for deliberate stretching (#11).
  const [lockImageAspect, setLockImageAspect] = useState(true);
  // The account's reusable-image library ("Your uploads"); loaded once and kept
  // in sync as the member uploads or removes assets (#16).
  const [assets, setAssets] = useState<DesignAsset[]>([]);

  useEffect(() => {
    let active = true;
    clientApiFetch<DesignAsset[]>("/design-assets")
      .then((items) => {
        if (active) setAssets(items);
      })
      .catch(() => {
        /* Non-fatal: the editor still works without the uploads library. */
      });
    return () => {
      active = false;
    };
  }, []);
  // Whether the currently-selected text element spills outside the print safe
  // area — reported up from the canvas, which measures the rendered text.
  const [selectedOverflow, setSelectedOverflow] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The text-element editor's textarea, so "Insert merge field" can drop a token
  // at the caret. `pendingCaret` holds where to place the caret after the
  // controlled re-render that follows an insertion.
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

  // A snapshot of what's currently persisted, so we can tell whether there are
  // unsaved edits and warn before leaving the editor. Updated on every save.
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify({ name: savedDesign.name, document: savedDesign.document }),
  );
  const isDirty = JSON.stringify({ name, document: document_ }) !== savedSnapshot;

  // Guard a full-page navigation / refresh while there are unsaved edits (the
  // in-app "Back to designs" link is guarded separately, as SPA navigation
  // doesn't fire beforeunload; "Send this card" saves first, so it won't warn).
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const page = document_.pages.find((p) => p.name === activePage) ?? document_.pages[0]!;
  const selectedElement = page.elements.find((el) => el.id === selectedElementId) ?? null;

  /** Change the selection, clearing any stale overflow warning — the canvas
   * re-reports for the newly selected text element (and never for non-text). */
  function selectElement(id: string | null) {
    setSelectedElementId(id);
    setSelectedOverflow(false);
  }

  function updatePage(pageName: DesignPage["name"], updater: (page: DesignPage) => DesignPage) {
    setDocument((doc) => ({
      ...doc,
      pages: doc.pages.map((p) => (p.name === pageName ? updater(p) : p)),
    }));
  }

  function addTextElement() {
    const element = newTextElement();
    updatePage(activePage, (p) => ({ ...p, elements: [...p.elements, element] }));
    selectElement(element.id);
  }

  function addQrElement() {
    const element = newQrElement();
    updatePage(activePage, (p) => ({ ...p, elements: [...p.elements, element] }));
    selectElement(element.id);
  }

  /** Whether a QR element is placed anywhere in the design (any face). */
  const hasQr = document_.pages.some((p) => p.elements.some((el) => el.kind === "qr"));

  /** Square-bracket "[name]" mistakes that should be curly-brace merge tokens. */
  const bracketMistakes = findDesignBracketTokenMistakes(document_);

  /** Rewrite every recognised "[name]"-style mistake to its curly token. */
  function fixAllBracketTokens() {
    setError(null);
    setDocument((doc) => fixDesignBracketTokens(doc));
  }

  function updateElement(updated: DesignElement) {
    updatePage(activePage, (p) => ({
      ...p,
      elements: p.elements.map((el) => (el.id === updated.id ? updated : el)),
    }));
  }

  // After an "Insert merge field" edit re-renders the controlled textarea, put
  // the caret just after the inserted token so typing continues in place.
  useEffect(() => {
    if (pendingCaretRef.current === null || !textAreaRef.current) return;
    const caret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    textAreaRef.current.focus();
    textAreaRef.current.setSelectionRange(caret, caret);
  });

  /** Insert a merge token (e.g. "{firstName}") into the selected text element at
   * the current caret / selection, replacing any selected text. Falls back to
   * appending at the end if the textarea isn't focused. */
  function insertMergeField(token: string) {
    if (selectedElement?.kind !== "text") return;
    const textarea = textAreaRef.current;
    const current = selectedElement.text;
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    pendingCaretRef.current = start + token.length;
    updateElement({ ...selectedElement, text: next });
  }

  function deleteSelected() {
    if (!selectedElementId) return;
    updatePage(activePage, (p) => ({
      ...p,
      elements: p.elements.filter((el) => el.id !== selectedElementId),
    }));
    selectElement(null);
  }

  /** Place an image element on the active page, sized to preserve its aspect
   * ratio (natural dimensions when known, else a square fallback). Shared by a
   * fresh upload and the "Your uploads" library picker. */
  function insertImage(url: string, naturalW: number | null, naturalH: number | null) {
    const { width, height } = fitWithinBox(
      { width: naturalW ?? IMAGE_INSERT_MAX, height: naturalH ?? IMAGE_INSERT_MAX },
      IMAGE_INSERT_MAX,
    );
    const element: Extract<DesignElement, { kind: "image" }> = {
      kind: "image",
      id: crypto.randomUUID(),
      assetUrl: url,
      x: 40,
      y: 40,
      width,
      height,
      rotation: 0,
    };
    updatePage(activePage, (p) => ({ ...p, elements: [...p.elements, element] }));
    selectElement(element.id);
  }

  async function handleImageUpload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const signed = await clientApiFetch<SignedUpload>("/uploads/design-assets", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });

      // Read the file's natural dimensions up front so the placed element keeps
      // the photo's real aspect ratio — a square default (the old 150×150) is
      // what squashed portrait/landscape photos out of shape (#11).
      const naturalSize = await readImageSize(file);

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("design-assets")
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (uploadError) {
        throw new Error(uploadError.message);
      }

      insertImage(signed.publicUrl, naturalSize.width, naturalSize.height);

      // Record it in the reusable-uploads library so it can be placed again
      // later without re-uploading (#16). Non-fatal if it fails — the image is
      // already on the card.
      try {
        const asset = await clientApiFetch<DesignAsset>("/design-assets", {
          method: "POST",
          body: JSON.stringify({
            url: signed.publicUrl,
            fileName: file.name,
            width: naturalSize.width,
            height: naturalSize.height,
          }),
        });
        setAssets((current) => [asset, ...current]);
      } catch {
        /* library is best-effort */
      }
    } catch (uploadCatchError) {
      setError(uploadCatchError instanceof Error ? uploadCatchError.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /** Remove an asset from the "Your uploads" library. This only forgets it from
   * the library — a card already using the image keeps rendering (the storage
   * object is left in place). */
  async function removeAsset(id: string) {
    const previous = assets;
    setAssets((current) => current.filter((a) => a.id !== id));
    try {
      await clientApiFetch(`/design-assets/${id}`, { method: "DELETE" });
    } catch {
      setAssets(previous); // restore on failure
    }
  }

  /** Persist the current name + document, updating the saved snapshot so the
   * editor is no longer "dirty". Throws on failure so callers can react. */
  async function persist() {
    await clientApiFetch<SavedDesign>(`/saved-designs/${savedDesign.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, document: document_ }),
    });
    setSavedSnapshot(JSON.stringify({ name, document: document_ }));
    setSavedAt(new Date());
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await persist();
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  /** Save any unsaved edits first, then go to the send flow — so the card that's
   * sent is always what's on screen, not the last-saved version. */
  async function handleSendThisCard() {
    setError(null);
    setSending(true);
    try {
      if (isDirty) await persist();
      // Full navigation so the send page re-reads the freshly-saved design.
      window.location.assign(`/designs/${savedDesign.id}/send`);
    } catch (sendError) {
      setError(sendError instanceof ApiError ? sendError.message : "Could not save before sending");
      setSending(false);
    }
  }

  /** Save any unsaved edits, then return to the bulk-send composer that sent us
   * here — so a mid-bulk design edit doesn't lose the recipient selection. */
  async function handleReturnToBulk() {
    if (!bulkReturnTo) return;
    setError(null);
    setSending(true);
    try {
      if (isDirty) await persist();
      window.location.assign(bulkReturnTo);
    } catch (returnError) {
      setError(
        returnError instanceof ApiError ? returnError.message : "Could not save your changes",
      );
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {/* Back link. When we arrived from bulk send, it returns there (keeping
            the recipient selection); otherwise back to the library. Guard the
            SPA navigation when there are unsaved edits — beforeunload only covers
            full-page navigations. */}
        <Link
          href={bulkReturnTo ?? "/designs"}
          onClick={(event) => {
            if (isDirty && !window.confirm("You have unsaved changes. Leave without saving?")) {
              event.preventDefault();
            }
          }}
          className="w-fit text-sm text-muted hover:text-foreground"
        >
          {bulkReturnTo ? "← Back to bulk send" : "← Back to designs"}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Design name"
            className="min-w-0 flex-1 rounded-md border border-black/10 px-3 py-2 text-lg font-semibold dark:border-white/10"
          />
          <div className="flex items-center gap-3">
            {isDirty ? (
              <span className="text-xs text-foreground/50">Unsaved changes</span>
            ) : savedAt ? (
              <span className="text-xs text-foreground/50">
                Saved {savedAt.toLocaleTimeString()}
              </span>
            ) : null}
            <button
              type="button"
              disabled={saving || sending}
              onClick={() => void handleSave()}
              className="rounded-full border border-black/15 px-5 py-2 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/5"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {bulkReturnTo ? (
              <button
                type="button"
                disabled={saving || sending}
                onClick={() => void handleReturnToBulk()}
                className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {sending ? "Saving…" : "Done → back to bulk send"}
              </button>
            ) : (
              <button
                type="button"
                disabled={saving || sending}
                onClick={() => void handleSendThisCard()}
                className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {sending ? "Saving…" : "Send this card →"}
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {bracketMistakes.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              These won&apos;t personalise — use curly braces, not square brackets
            </p>
            <button
              type="button"
              onClick={fixAllBracketTokens}
              className="shrink-0 rounded-full bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              Fix all automatically
            </button>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {bracketMistakes.map((m) => (
              <li key={m.found} className="font-mono">
                <span className="line-through opacity-70">{m.found}</span>
                {" → "}
                <span className="font-semibold">{m.suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-black/10 pb-2 dark:border-white/10">
        {PAGE_NAMES.map((pageName) => (
          <button
            key={pageName}
            type="button"
            onClick={() => {
              setActivePage(pageName);
              selectElement(null);
            }}
            className={`rounded-full px-4 py-2 text-sm ${
              activePage === pageName
                ? "bg-foreground text-background"
                : "text-foreground/60 hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {pageName}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addTextElement}
              className="rounded-full border border-black/20 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/5"
            >
              Add text
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full border border-black/20 px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5"
            >
              {uploading ? "Uploading…" : "Add image"}
            </button>
            <button
              type="button"
              onClick={addQrElement}
              className="rounded-full border border-black/20 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/5"
            >
              Add video QR
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImageUpload(file);
              }}
            />
          </div>

          {assets.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
              <span className="text-xs font-medium text-foreground/70">
                Your uploads — click to place again
              </span>
              <div className="flex flex-wrap gap-2">
                {assets.map((asset) => (
                  <div key={asset.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => insertImage(asset.url, asset.width, asset.height)}
                      title={`Add ${asset.fileName}`}
                      className="size-14 overflow-hidden rounded-md border border-black/10 hover:ring-2 hover:ring-accent dark:border-white/10"
                    >
                      {/* Library thumbnails come from arbitrary user uploads, so a
                          plain <img> (not next/image) is intentional here. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset.url}
                        alt={asset.fileName}
                        className="size-full object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeAsset(asset.id)}
                      aria-label={`Remove ${asset.fileName} from your uploads`}
                      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-black/10 bg-surface text-xs text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 dark:border-white/10"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasQr && (
            <label className="flex flex-col gap-1 rounded-lg border border-black/10 p-3 text-xs text-foreground/60 dark:border-white/10">
              <span className="font-medium text-foreground">Video link (for the QR code)</span>
              <input
                type="url"
                inputMode="url"
                placeholder="https://youtu.be/…"
                value={document_.videoUrl ?? ""}
                onChange={(e) =>
                  setDocument((doc) => ({ ...doc, videoUrl: e.target.value || null }))
                }
                className="rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/10"
              />
              <span>
                Recipients scan the QR to watch this. It&apos;s the default for every card from this
                design — you can personalise or change it per recipient later on the Messages page.
              </span>
            </label>
          )}

          {/* The canvas scales itself to fit the container (see DesignCanvas),
              so the whole card shows and elements stay draggable on a phone —
              no horizontal scroll. */}
          <DesignCanvas
            page={page}
            selectedElementId={selectedElementId}
            onSelect={selectElement}
            onElementChange={updateElement}
            onDeselect={() => selectElement(null)}
            onSelectedOverflowChange={setSelectedOverflow}
          />
        </div>

        <aside className="flex w-full flex-col gap-3 rounded-lg border border-black/10 p-4 sm:w-64 lg:sticky lg:top-4 lg:w-72 lg:self-start dark:border-white/10">
          <h2 className="text-sm font-semibold">
            {selectedElement ? "Selected element" : "Nothing selected"}
          </h2>

          {selectedElement?.kind === "text" && (
            <>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Text
                <textarea
                  ref={textAreaRef}
                  value={selectedElement.text}
                  onChange={(e) => updateElement({ ...selectedElement, text: e.target.value })}
                  rows={3}
                  className="rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/10"
                />
              </label>
              {/* Insert a merge token at the caret — so designers pick "First
                  name" instead of remembering {"{firstName}"}. The select resets
                  to its placeholder after each pick so the same field can be
                  inserted again. */}
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Insert merge field — fills in per recipient when sent
                <select
                  aria-label="Insert merge field"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) insertMergeField(e.target.value);
                  }}
                  className="rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/10"
                >
                  <option value="">Insert merge field…</option>
                  {MERGE_FIELDS.map((field) => (
                    <option key={field.token} value={field.token}>
                      {field.label}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-foreground/50">
                  Tip: any custom recipient field works too — type it as {"{fieldName}"} (e.g.{" "}
                  {"{teacher}"}).
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Font
                <select
                  value={selectedElement.fontFamily}
                  onChange={(e) =>
                    updateElement({ ...selectedElement, fontFamily: e.target.value })
                  }
                  className="rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/10"
                >
                  {FONT_OPTIONS.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Size
                <input
                  type="number"
                  min={8}
                  max={96}
                  value={selectedElement.fontSize}
                  onChange={(e) =>
                    updateElement({ ...selectedElement, fontSize: Number(e.target.value) || 1 })
                  }
                  className="rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/10"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Colour
                <input
                  type="color"
                  value={selectedElement.color}
                  onChange={(e) => updateElement({ ...selectedElement, color: e.target.value })}
                  className="h-8 w-full rounded-md border border-black/10 dark:border-white/10"
                />
              </label>
              {/* Text-box width guard rail: a set width word-wraps the text
                  within it; "Fit to card" clears it back to wrapping at the
                  card edge. Keeps long text from running off the card. */}
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Text box width
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={40}
                    max={CARD_WIDTH}
                    placeholder="Fits to card"
                    value={selectedElement.width ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      const next = raw === "" ? undefined : Math.min(CARD_WIDTH, Math.max(40, Number(raw) || 40));
                      updateElement({ ...selectedElement, width: next });
                    }}
                    className="w-full rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/10"
                  />
                  {selectedElement.width !== undefined && (
                    <button
                      type="button"
                      onClick={() => updateElement({ ...selectedElement, width: undefined })}
                      className="shrink-0 rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
                    >
                      Fit to card
                    </button>
                  )}
                </div>
              </label>
              <div className="flex flex-col gap-1 text-xs text-foreground/60">
                Alignment
                <div className="flex gap-1">
                  {(["left", "center", "right"] as const).map((align) => {
                    const active = (selectedElement.align ?? "left") === align;
                    return (
                      <button
                        key={align}
                        type="button"
                        aria-pressed={active}
                        onClick={() => updateElement({ ...selectedElement, align })}
                        className={`flex-1 rounded-md border px-2 py-1 text-xs capitalize ${
                          active
                            ? "border-accent bg-accent/10 font-semibold text-foreground"
                            : "border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
                        }`}
                      >
                        {align}
                      </button>
                    );
                  })}
                </div>
              </div>
              {selectedOverflow && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                  This text spills outside the card&apos;s safe area (the dashed frame). Shorten it,
                  shrink the font, or narrow the box so it isn&apos;t clipped when printed.
                </p>
              )}
            </>
          )}

          {selectedElement?.kind === "image" && (
            <>
              <label className="flex items-center gap-2 text-xs text-foreground/70">
                <input
                  type="checkbox"
                  checked={lockImageAspect}
                  onChange={(e) => setLockImageAspect(e.target.checked)}
                />
                Lock aspect ratio (keeps the photo from stretching)
              </label>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Width
                <input
                  type="number"
                  min={10}
                  value={selectedElement.width}
                  onChange={(e) => {
                    const width = Number(e.target.value) || 1;
                    const height = lockImageAspect
                      ? Math.max(1, Math.round(width * (selectedElement.height / selectedElement.width)))
                      : selectedElement.height;
                    updateElement({ ...selectedElement, width, height });
                  }}
                  className="rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/10"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Height
                <input
                  type="number"
                  min={10}
                  value={selectedElement.height}
                  onChange={(e) => {
                    const height = Number(e.target.value) || 1;
                    const width = lockImageAspect
                      ? Math.max(1, Math.round(height * (selectedElement.width / selectedElement.height)))
                      : selectedElement.width;
                    updateElement({ ...selectedElement, width, height });
                  }}
                  className="rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/10"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Rotation (degrees)
                <input
                  type="number"
                  value={selectedElement.rotation}
                  onChange={(e) =>
                    updateElement({ ...selectedElement, rotation: Number(e.target.value) || 0 })
                  }
                  className="rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/10"
                />
              </label>
            </>
          )}

          {selectedElement?.kind === "qr" && (
            <>
              <p className="text-xs text-foreground/60">
                A QR code linking to each recipient&apos;s video message. Set the video in the
                &ldquo;Video link&rdquo; box above, drag it on the card to position it, and size it
                here.
              </p>
              <div className="flex flex-col gap-1.5 text-xs text-foreground/60">
                <span>Size</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Make smaller"
                    onClick={() =>
                      updateElement({
                        ...selectedElement,
                        size: Math.max(40, selectedElement.size - 10),
                      })
                    }
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-black/15 text-xl hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={40}
                    max={300}
                    value={selectedElement.size}
                    onChange={(e) =>
                      updateElement({
                        ...selectedElement,
                        size: Math.min(300, Math.max(40, Number(e.target.value) || 40)),
                      })
                    }
                    className="h-11 w-16 rounded-md border border-black/10 px-2 text-center text-sm dark:border-white/10"
                  />
                  <button
                    type="button"
                    aria-label="Make larger"
                    onClick={() =>
                      updateElement({
                        ...selectedElement,
                        size: Math.min(300, selectedElement.size + 10),
                      })
                    }
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-black/15 text-xl hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
                  >
                    +
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  updateElement({
                    ...selectedElement,
                    rotation: (selectedElement.rotation + 90) % 360,
                  })
                }
                className="flex h-11 items-center justify-center gap-2 rounded-md border border-black/15 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
              >
                Rotate 90°
                <span className="text-foreground/50">{selectedElement.rotation}°</span>
              </button>
            </>
          )}

          {selectedElement && (
            <button
              type="button"
              onClick={deleteSelected}
              className="mt-2 rounded-full border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
            >
              Delete
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
