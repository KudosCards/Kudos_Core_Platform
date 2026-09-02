"use client";

import type {
  DesignAsset,
  DesignDocument,
  DesignElement,
  DesignPage,
  MessagePageSummary,
  PageBackground,
  SavedDesign,
  ShapeKind,
} from "@kudos/shared-types";
import type { LayerMove } from "@kudos/shared-types";
import {
  BACK_RESERVED_FOOTER_MM,
  CARD_HEIGHT,
  CARD_SAFE_MARGIN,
  CARD_WIDTH,
  DEFAULT_CARD_SIZE,
  EDITOR_FONTS,
  FONT_CATEGORY_ORDER,
  MERGE_FIELDS,
  PRINT_DPI_TARGET,
  elementPrintedSizeMm,
  findDesignBracketTokenMistakes,
  fixDesignBracketTokens,
  imagePrintDpi,
  printDpiVerdict,
  reorderElement,
} from "@kudos/shared-types";
import { FontPreloader } from "@/lib/editor-fonts";
import { clearDraft, readDraft, writeDraft, type DesignDraft } from "@/lib/design-draft";
import { STICKERS, STICKER_INSERT_SIZE } from "@/lib/stickers";
import { CLIPART_CATEGORIES } from "@/lib/clipart";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { createClient } from "@/lib/supabase/client";

const DesignCanvas = dynamic(() => import("./design-canvas").then((mod) => mod.DesignCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-[105/148] w-full max-w-[640px] items-center justify-center rounded-md border border-black/10 text-sm text-foreground/50">
      Loading canvas…
    </div>
  ),
});

const PAGE_NAMES: DesignPage["name"][] = ["front", "inside-left", "inside-right", "back"];

/** The font picker's options, grouped by category in the shared display order. */
const FONT_GROUPS = FONT_CATEGORY_ORDER.map(({ category, label }) => ({
  label,
  fonts: EDITOR_FONTS.filter((f) => f.category === category).map((f) => f.key),
})).filter((group) => group.fonts.length > 0);

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

/**
 * A freshly-added text box gets an explicit width narrower than the safe area
 * and is horizontally centred on the card, with its text centre-aligned — so it
 * lands cleanly in the middle inside the guard rails rather than left-anchored
 * and stretching past the safe margin. Sits just inside the top safe margin so
 * it reads as deliberately placed. */
const NEW_TEXT_WIDTH = CARD_WIDTH - CARD_SAFE_MARGIN * 6; // 450 - 144 = 306

function newTextElement(existingCount: number): Extract<DesignElement, { kind: "text" }> {
  // Cascade successive boxes down-right so they don't stack. The box keeps its
  // top-centred base (text auto-grows downward, so it isn't vertically centred);
  // the step is clamped to keep the wide box's right edge inside the safe area.
  const step = (existingCount % PLACEMENT_WRAP) * PLACEMENT_STEP;
  const baseX = (CARD_WIDTH - NEW_TEXT_WIDTH) / 2;
  const maxX = CARD_WIDTH - CARD_SAFE_MARGIN - NEW_TEXT_WIDTH;
  return {
    kind: "text",
    id: crypto.randomUUID(),
    text: "New text",
    x: Math.min(maxX, Math.round(baseX + step)),
    y: CARD_SAFE_MARGIN + 16 + step,
    width: NEW_TEXT_WIDTH,
    align: "center",
    fontFamily: "Helvetica",
    fontSize: 20,
    color: "#111111",
  };
}

/** Down-right step (design units) between successive added elements, so several
 * inserts cascade instead of landing exactly on top of one another. */
const PLACEMENT_STEP = 20;
/** How many cascade steps before placement wraps back to centre. */
const PLACEMENT_WRAP = 5;

/**
 * A centred origin for a freshly-added element of known size, nudged down-right
 * by one cascade step per element already on the page so repeated inserts don't
 * stack. Always clamped so the whole box sits inside the safe area (a box larger
 * than the safe area pins to the top-left safe corner). Pure. */
function placedOrigin(
  size: { width: number; height: number },
  existingCount: number,
): { x: number; y: number } {
  const step = (existingCount % PLACEMENT_WRAP) * PLACEMENT_STEP;
  const clampAxis = (cardDim: number, dim: number) => {
    const centre = (cardDim - dim) / 2;
    const max = Math.max(CARD_SAFE_MARGIN, cardDim - CARD_SAFE_MARGIN - dim);
    return Math.min(max, Math.max(CARD_SAFE_MARGIN, Math.round(centre + step)));
  };
  return {
    x: clampAxis(CARD_WIDTH, size.width),
    y: clampAxis(CARD_HEIGHT, size.height),
  };
}

const QR_SIZE = 120;

function newQrElement(existingCount: number): Extract<DesignElement, { kind: "qr" }> {
  return {
    kind: "qr",
    id: crypto.randomUUID(),
    ...placedOrigin({ width: QR_SIZE, height: QR_SIZE }, existingCount),
    size: QR_SIZE,
    rotation: 0,
  };
}

/** The shapes offered in the "Add shape" palette, with a glyph for the button. */
const SHAPE_PALETTE: { shape: ShapeKind; glyph: string; label: string }[] = [
  { shape: "rect", glyph: "▭", label: "Rectangle" },
  { shape: "ellipse", glyph: "⬭", label: "Ellipse" },
  { shape: "triangle", glyph: "△", label: "Triangle" },
  { shape: "star", glyph: "★", label: "Star" },
  { shape: "heart", glyph: "♥", label: "Heart" },
  { shape: "line", glyph: "─", label: "Line" },
];

function newShapeElement(
  shape: ShapeKind,
  existingCount: number,
): Extract<DesignElement, { kind: "shape" }> {
  const isLine = shape === "line";
  const width = 120;
  const height = isLine ? 8 : 120;
  return {
    kind: "shape",
    id: crypto.randomUUID(),
    shape,
    ...placedOrigin({ width, height }, existingCount),
    width,
    height,
    // A line is stroke-only; the other shapes get a soft default fill.
    fill: isLine ? undefined : "#93c5fd",
    stroke: isLine ? "#111111" : undefined,
    strokeWidth: isLine ? 4 : undefined,
    rotation: 0,
  };
}

export function DesignEditorClient({
  savedDesign,
  returnTo,
  messagePages,
  canAuthorMessagePages,
}: {
  savedDesign: SavedDesign;
  returnTo?: string;
  messagePages: MessagePageSummary[];
  canAuthorMessagePages: boolean;
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
  // Separate flag for a page-background image upload (distinct from an element
  // image upload above), so only the relevant button shows "Uploading…".
  const [bgUploading, setBgUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // A save/send failure, kept as a persistent, actionable banner (not a
  // disappearing line) so the member always has a clear next step. `authExpired`
  // tailors the copy when the session timed out. See docs/adr/0143.
  const [saveError, setSaveError] = useState<{ message: string; authExpired: boolean } | null>(
    null,
  );
  // An unsaved local draft found on mount (newer than the server copy) — offered
  // for one-click restore instead of silently losing the member's work.
  const [recoverable, setRecoverable] = useState<DesignDraft | null>(null);
  // The exact edit that was last mirrored to localStorage (a name+document
  // snapshot string). Compared against the current edit during render to derive
  // whether the member's work is backed up on this device — no effect-synced
  // boolean, so the "backed up" chip stays a pure function of state.
  const [backedUpSnapshot, setBackedUpSnapshot] = useState<string | null>(null);
  // The last mirror attempt was refused by the browser (storage full, or blocked
  // in private mode). Distinct from "not backed up yet": there is no later point
  // at which this edit becomes safe on its own, so the member is told plainly
  // rather than left with a chip that never changes.
  const [backupBlocked, setBackupBlocked] = useState(false);
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
  // Whether anything on the back face reaches into the strip that's already
  // printed on the card stock (the Kudos logo and QR). Page-level, not
  // selection-level: the case this exists for is a back filled edge-to-edge, and
  // warning about one tile at a time would badly understate it.
  const [reservedFooterOverlap, setReservedFooterOverlap] = useState(false);

  // Natural pixel sizes of placed images, keyed by asset URL — measured on demand
  // so we can warn when an image is too low-resolution to print sharply at the
  // size it's placed (docs/adr/0162).
  const [imageNaturalSizes, setImageNaturalSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
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
  const currentSnapshot = JSON.stringify({ name, document: document_ });
  const isDirty = currentSnapshot !== savedSnapshot;
  // Derived (not effect-synced): the current unsaved edits have been mirrored to
  // localStorage, so the status chip can reassure the member their work is safe.
  const locallyBackedUp = isDirty && backedUpSnapshot === currentSnapshot;

  // Guard a full-page navigation / refresh while there are unsaved edits — but
  // only until the debounced autosave has mirrored them to localStorage. Once
  // the work is backed up on this device (and restorable on return), the harsh
  // native "leave site?" prompt is redundant, so we drop it: adding an image no
  // longer nags a second later. The brief pre-autosave window still gets it —
  // and so does a storage-blocked browser, which is what this comment always
  // claimed and the code did not do until ADR 0182: `setBackedUpSnapshot` ran
  // whether or not the write had thrown, so `locallyBackedUp` went true anyway
  // and the guard came off.
  // The in-app "Back to designs" link is guarded separately below; "Send this
  // card" saves first, so it won't warn.
  useEffect(() => {
    if (!isDirty || locallyBackedUp) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, locallyBackedUp]);

  // On mount, surface any unsaved local draft that differs from the server copy
  // — the member left mid-edit (timeout, crash, accidental Back) and we can give
  // their work back rather than lose it. Runs once.
  useEffect(() => {
    const draft = readDraft(savedDesign.id);
    if (draft && JSON.stringify({ name: draft.name, document: draft.document }) !== savedSnapshot) {
      // Reading a persisted draft from localStorage on mount is the legitimate
      // "sync from an external system" case — it can't run during render (SSR
      // has no localStorage, and a lazy initialiser would hydration-mismatch).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecoverable(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror unsaved edits into localStorage, debounced, so nothing is lost if the
  // tab dies, the session times out, or a save fails. Cleared on a real save.
  useEffect(() => {
    if (!isDirty) return;
    const snapshot = currentSnapshot;
    const timer = window.setTimeout(() => {
      const written = writeDraft(savedDesign.id, { name, document: document_, ts: Date.now() });
      // Only claim a backup that actually happened. This used to be
      // unconditional, so a quota-full or storage-blocked browser reported the
      // work safe, dropped both leave-guards, and then had nothing to restore.
      // See ADR 0182.
      setBackedUpSnapshot(written ? snapshot : null);
      setBackupBlocked(!written);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [isDirty, currentSnapshot, name, document_, savedDesign.id]);

  const page = document_.pages.find((p) => p.name === activePage) ?? document_.pages[0]!;
  // A background always covers the reserved strip, and the canvas's overlap
  // check only sees *elements* — a background is not one. That gap is why a back
  // filled edge to edge with artwork produced no warning at all. Read straight
  // from the page rather than measured, since it needs no measuring.
  const backHasBackground = activePage === "back" && page.background != null;
  const selectedElement = page.elements.find((el) => el.id === selectedElementId) ?? null;

  // Measure the selected image's natural pixel size (once per URL) so the panel
  // can flag a low print resolution. SVGs are vector — skip them.
  const selectedImageUrl =
    selectedElement?.kind === "image" && !/\.svg(\?|#|$)/i.test(selectedElement.assetUrl)
      ? selectedElement.assetUrl
      : null;
  useEffect(() => {
    if (!selectedImageUrl || imageNaturalSizes[selectedImageUrl]) return;
    // No crossOrigin: we only read naturalWidth/Height, which needs no CORS, and
    // requesting it would fail the load on assets served without CORS headers.
    const img = new window.Image();
    img.onload = () =>
      setImageNaturalSizes((prev) => ({
        ...prev,
        [selectedImageUrl]: { width: img.naturalWidth, height: img.naturalHeight },
      }));
    img.src = selectedImageUrl;
  }, [selectedImageUrl, imageNaturalSizes]);

  // Effective print DPI of the selected image at the house card size, given its
  // current on-card box — recomputes live as it's resized. Null until measured.
  const selectedImageDpi = useMemo(() => {
    if (selectedElement?.kind !== "image" || !selectedImageUrl) return null;
    const natural = imageNaturalSizes[selectedImageUrl];
    if (!natural) return null;
    const printed = elementPrintedSizeMm(
      { width: selectedElement.width, height: selectedElement.height },
      DEFAULT_CARD_SIZE,
    );
    return imagePrintDpi(natural, printed);
  }, [selectedElement, selectedImageUrl, imageNaturalSizes]);

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
    const element = newTextElement(activePageElementCount());
    updatePage(activePage, (p) => ({ ...p, elements: [...p.elements, element] }));
    selectElement(element.id);
  }

  /** How many elements a page already holds — drives the cascade offset so a
   * freshly-added element doesn't land exactly on the previous one. */
  function pageElementCount(page: DesignPage["name"]) {
    return document_.pages.find((p) => p.name === page)?.elements.length ?? 0;
  }

  function activePageElementCount() {
    return pageElementCount(activePage);
  }

  function addQrElement() {
    const element = newQrElement(activePageElementCount());
    updatePage(activePage, (p) => ({ ...p, elements: [...p.elements, element] }));
    selectElement(element.id);
  }

  function addShapeElement(shape: ShapeKind) {
    const element = newShapeElement(shape, activePageElementCount());
    updatePage(activePage, (p) => ({ ...p, elements: [...p.elements, element] }));
    selectElement(element.id);
  }

  /** Whether a QR element is placed anywhere in the design (any face). */
  const hasQr = document_.pages.some((p) => p.elements.some((el) => el.kind === "qr"));

  // The QR's destination (ADR 0137): a linked Message Page is the first-class
  // option; a raw video link is the shortcut. `qrMode` is the intent (so a user
  // with no pages yet can still choose "message page" and see the create
  // prompt); `document_.messagePageId` is the persisted choice.
  const activeQrMessagePages = useMemo(
    () => messagePages.filter((mp) => mp.status === "active"),
    [messagePages],
  );
  const [qrMode, setQrMode] = useState<"page" | "video">(
    savedDesign.document.messagePageId ? "page" : "video",
  );
  const selectedQrMessagePage =
    activeQrMessagePages.find((mp) => mp.id === document_.messagePageId) ?? null;

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

  /** Duplicate the selected element in place (offset slightly so both are
   * visible) and select the copy — the ⌘/Ctrl+D shortcut and a quick way to
   * repeat a laid-out element without redoing it. */
  function duplicateSelected() {
    if (!selectedElement) return;
    const copy = {
      ...selectedElement,
      id: crypto.randomUUID(),
      x: selectedElement.x + 16,
      y: selectedElement.y + 16,
    };
    updatePage(activePage, (p) => ({ ...p, elements: [...p.elements, copy] }));
    selectElement(copy.id);
  }

  /** Move the selected element by (dx, dy) design units, keeping it on the card
   * — the arrow-key nudge for pixel-precise placement. */
  function nudgeSelected(dx: number, dy: number) {
    if (!selectedElement) return;
    updateElement({ ...selectedElement, x: selectedElement.x + dx, y: selectedElement.y + dy });
  }

  /** Restack the selected element (the array order is the z-order — later draws
   * on top), for bring-forward / send-back layer controls. */
  function reorderSelected(move: LayerMove) {
    if (!selectedElementId) return;
    updatePage(activePage, (p) => ({
      ...p,
      elements: reorderElement(p.elements, selectedElementId, move),
    }));
  }

  /** Whether the selected element is already at the top / bottom of the stack,
   * so the layer buttons can disable the no-op direction. */
  const selectedIndex = selectedElementId
    ? page.elements.findIndex((el) => el.id === selectedElementId)
    : -1;
  const isFrontmost = selectedIndex === page.elements.length - 1;
  const isBackmost = selectedIndex === 0;

  /** Set (or clear) the active page's background fill. */
  function setPageBackground(background: PageBackground | undefined) {
    updatePage(activePage, (p) => ({ ...p, background }));
  }

  /** Switch the active page's background between none / colour / image. Picking
   * "image" opens the file picker; the background is set once the upload lands. */
  function selectBackgroundType(type: "none" | "color" | "image") {
    if (type === "none") {
      setPageBackground(undefined);
    } else if (type === "color") {
      // Keep an existing colour; otherwise start from a soft neutral so the
      // change is visible immediately (they can then pick any colour).
      setPageBackground(
        page.background?.type === "color" ? page.background : { type: "color", color: "#e5e7eb" },
      );
    } else {
      bgFileInputRef.current?.click();
    }
  }

  /** Upload an image and set it as the active page's background. Reuses the same
   * signed-upload flow as element images and records it in the uploads library. */
  async function handleBackgroundUpload(file: File) {
    setError(null);
    setBgUploading(true);
    try {
      const signed = await clientApiFetch<SignedUpload>("/uploads/design-assets", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("design-assets")
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (uploadError) throw new Error(uploadError.message);

      setPageBackground({ type: "image", assetUrl: signed.publicUrl });

      // Record it in the reusable-uploads library too (non-fatal on failure).
      try {
        const naturalSize = await readImageSize(file);
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
      setBgUploading(false);
      if (bgFileInputRef.current) bgFileInputRef.current.value = "";
    }
  }

  // Canvas keyboard shortcuts (Moonpig-style direct editing): Delete/Backspace
  // removes the selected element, Escape deselects, the arrow keys nudge it
  // (Shift = a bigger step), and ⌘/Ctrl+D duplicates it. Ignored while typing in
  // a field so they never hijack normal text entry.
  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && (event.key === "d" || event.key === "D")) {
        if (!selectedElement) return;
        event.preventDefault();
        duplicateSelected();
        return;
      }
      // Layer order: ⌘/Ctrl+] forward, +[ backward; add Shift for front/back.
      if ((event.metaKey || event.ctrlKey) && (event.key === "]" || event.key === "[")) {
        if (!selectedElementId) return;
        event.preventDefault();
        const forward = event.key === "]";
        reorderSelected(
          event.shiftKey ? (forward ? "front" : "back") : forward ? "forward" : "backward",
        );
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selectedElementId) return;
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (event.key === "Escape") {
        if (!selectedElementId) return;
        selectElement(null);
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      const nudges: Record<string, [number, number]> = {
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
      };
      const delta = nudges[event.key];
      if (delta && selectedElement) {
        event.preventDefault();
        nudgeSelected(delta[0], delta[1]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElementId, selectedElement, activePage]);

  /** Place an image element on the active page, sized to preserve its aspect
   * ratio (natural dimensions when known, else a square fallback). Shared by a
   * fresh upload and the "Your uploads" library picker. */
  /**
   * Place an image on `page`, defaulting to the face on screen.
   *
   * An upload takes seconds, and the face can change in that time. The image
   * belongs on the face it was added from — that is what was asked for — so the
   * caller passes the page it captured before awaiting, and the editor is
   * brought back to it. Reading `activePage` here instead put the image on the
   * face the person had left, selected an id not on the visible page, and said
   * nothing: the panel read "Nothing selected" and the photo was nowhere on
   * screen. See ADR 0205.
   */
  function insertImage(
    url: string,
    naturalW: number | null,
    naturalH: number | null,
    page: DesignPage["name"] = activePage,
  ) {
    const { width, height } = fitWithinBox(
      { width: naturalW ?? IMAGE_INSERT_MAX, height: naturalH ?? IMAGE_INSERT_MAX },
      IMAGE_INSERT_MAX,
    );
    const element: Extract<DesignElement, { kind: "image" }> = {
      kind: "image",
      id: crypto.randomUUID(),
      assetUrl: url,
      ...placedOrigin({ width, height }, pageElementCount(page)),
      width,
      height,
      rotation: 0,
    };
    updatePage(page, (p) => ({ ...p, elements: [...p.elements, element] }));
    setActivePage(page);
    selectElement(element.id);
  }

  /** Place a curated sticker (a self-hosted SVG) as an image element. Square
   * artwork, so it inserts at a fixed size. */
  function insertSticker(src: string) {
    insertImage(src, STICKER_INSERT_SIZE, STICKER_INSERT_SIZE);
  }

  async function handleImageUpload(file: File) {
    setError(null);
    setUploading(true);
    // The face this image was asked for, captured before the first await. An
    // upload is slow enough to switch face during, and everything below runs
    // against a render that may be several faces out of date by the time it
    // resumes.
    const targetPage = activePage;
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

      insertImage(signed.publicUrl, naturalSize.width, naturalSize.height, targetPage);

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

  /**
   * Throw the local mirror away, and forget that it existed.
   *
   * Both halves, always. `backedUpSnapshot` is what the "backed up on this
   * device" chip and the leave guard are derived from, and clearing the store
   * without clearing it left the claim standing against nothing: edit back to a
   * snapshot that *was* mirrored and the chip came on, the guard came off, and
   * the work was unrecoverable. That is the same defect ADR 0182 fixed on the
   * write side — the claim outliving the thing it claims — arriving from the
   * other direction. One function, so the pair cannot come apart again.
   * See ADR 0232.
   */
  function forgetLocalBackup() {
    clearDraft(savedDesign.id);
    setBackedUpSnapshot(null);
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
    // Safely on the server now — the local backup is no longer needed.
    forgetLocalBackup();
    setBackupBlocked(false);
    setSaveError(null);
  }

  /** Turn any save/send failure into a persistent, actionable banner. A 401
   * means the session timed out, so we point them at re-authenticating rather
   * than dead-ending them. Whether we can also reassure them that the work is
   * safe depends on whether the local mirror actually took — the banner reads
   * `locallyBackedUp` rather than assuming it. See ADR 0182. */
  function reportSaveFailure(err: unknown, fallback: string): void {
    const authExpired = err instanceof ApiError && err.status === 401;
    const message = authExpired
      ? "Your session timed out, so we couldn't save."
      : err instanceof ApiError
        ? err.message
        : fallback;
    setSaveError({ message, authExpired });
  }

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      await persist();
    } catch (saveErr) {
      reportSaveFailure(saveErr, "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  /** Save any unsaved edits first, then go to the send flow — so the card that's
   * sent is always what's on screen, not the last-saved version. */
  async function handleSendThisCard() {
    setSaveError(null);
    setSending(true);
    try {
      if (isDirty) await persist();
      // Full navigation so the send page re-reads the freshly-saved design.
      window.location.assign(`/designs/${savedDesign.id}/send`);
    } catch (sendErr) {
      reportSaveFailure(sendErr, "Could not save before sending.");
      setSending(false);
    }
  }

  /** Save any unsaved edits, then return to the bulk-send composer that sent us
   * here — so a mid-bulk design edit doesn't lose the recipient selection. */
  async function handleReturnToBulk() {
    if (!bulkReturnTo) return;
    setSaveError(null);
    setSending(true);
    try {
      if (isDirty) await persist();
      window.location.assign(bulkReturnTo);
    } catch (returnErr) {
      reportSaveFailure(returnErr, "Could not save your changes.");
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Warm the self-hosted web fonts so the canvas paints them for real. */}
      <FontPreloader />
      <div className="flex flex-col gap-3">
        {/* Back link. When we arrived from bulk send, it returns there (keeping
            the recipient selection); otherwise back to the library. Guard the
            SPA navigation when there are unsaved edits — beforeunload only covers
            full-page navigations. */}
        <Link
          href={bulkReturnTo ?? "/designs"}
          onClick={(event) => {
            // Once the edit is backed up on this device it's restorable on
            // return, so leaving is safe — no confirm. Only nag while a dirty
            // edit hasn't been mirrored yet.
            if (
              isDirty &&
              !locallyBackedUp &&
              !window.confirm("You have unsaved changes. Leave without saving?")
            ) {
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
            className="min-w-0 flex-1 rounded-md border border-black/10 px-3 py-2 text-lg font-semibold"
          />
          <div className="flex items-center gap-3">
            {isDirty ? (
              <span
                className={
                  backupBlocked && !locallyBackedUp
                    ? "text-xs font-medium text-amber-700"
                    : "text-xs text-foreground/50"
                }
              >
                {locallyBackedUp
                  ? "Unsaved · backed up on this device"
                  : backupBlocked
                    ? "Unsaved · can’t back up on this device — save now"
                    : "Unsaved changes"}
              </span>
            ) : savedAt ? (
              <span className="text-xs text-foreground/50">
                Saved {savedAt.toLocaleTimeString()}
              </span>
            ) : null}
            <button
              type="button"
              disabled={saving || sending}
              onClick={() => void handleSave()}
              className="rounded-full border border-black/15 px-5 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
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

      {recoverable && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex-1">
            You have <strong>unsaved changes</strong> from a previous session on this device.
          </span>
          <button
            type="button"
            onClick={() => {
              setName(recoverable.name);
              setDocument(recoverable.document);
              setRecoverable(null);
            }}
            className="rounded-full bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
          >
            Restore them
          </button>
          <button
            type="button"
            onClick={() => {
              forgetLocalBackup();
              setRecoverable(null);
            }}
            className="rounded-full border border-amber-400 px-4 py-1.5 text-xs font-medium hover:bg-amber-100"
          >
            Discard
          </button>
        </div>
      )}

      {saveError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">{saveError.message}</p>
          {/* Only promise the local backup when there actually is one. A failed
              save is the moment this reassurance carries the most weight, and
              the moment it is most damaging if untrue: it tells the member not
              to worry while their only copy is in a tab they may well close.
              See ADR 0182. */}
          {locallyBackedUp ? (
            <p className="mt-1 text-red-700">
              Your work is backed up on this device, so nothing is lost
              {saveError.authExpired
                ? " — sign in again in another tab, then come back and press Save."
                : "."}
            </p>
          ) : (
            <p className="mt-1 font-medium text-red-700">
              This browser wouldn’t let us keep a local copy, so these edits only exist on this
              screen — keep this tab open
              {saveError.authExpired
                ? " and sign in again in another tab, then come back and press Save."
                : " and try again."}
            </p>
          )}
          <button
            type="button"
            disabled={saving || sending}
            onClick={() => void handleSave()}
            className="mt-2 rounded-full border border-red-400 px-4 py-1.5 text-xs font-semibold hover:bg-red-100 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Try saving again"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {bracketMistakes.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              These won’t personalise — use curly braces, not square brackets
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

      {/* Page switcher (front / inside / back). Sticky so it stays reachable
          when the toolbar + canvas push it off-screen on a long scroll. */}
      <div className="sticky top-0 z-10 flex flex-wrap gap-2 border-b border-black/10 bg-background/95 py-2 backdrop-blur">
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
                : "text-foreground/60 hover:bg-black/5"
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
              className="rounded-full border border-black/20 px-4 py-2 text-sm hover:bg-black/5"
            >
              Add text
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full border border-black/20 px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Add image"}
            </button>
            <button
              type="button"
              onClick={addQrElement}
              className="rounded-full border border-black/20 px-4 py-2 text-sm hover:bg-black/5"
            >
              Add scan-to-watch QR
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

          {/* Shapes palette — native vector shapes, crisp and recolourable. */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-foreground/60">Shapes</span>
            {SHAPE_PALETTE.map(({ shape, glyph, label }) => (
              <button
                key={shape}
                type="button"
                title={`Add ${label.toLowerCase()}`}
                aria-label={`Add ${label.toLowerCase()}`}
                onClick={() => addShapeElement(shape)}
                className="flex size-9 items-center justify-center rounded-md border border-black/15 text-base leading-none hover:bg-black/5 pointer-coarse:size-11"
              >
                {glyph}
              </button>
            ))}
          </div>

          {/* Stickers palette — curated self-hosted SVG art, placed as images. */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-foreground/60">Stickers</span>
            {STICKERS.map((sticker) => (
              <button
                key={sticker.key}
                type="button"
                title={`Add ${sticker.label.toLowerCase()} sticker`}
                aria-label={`Add ${sticker.label.toLowerCase()} sticker`}
                onClick={() => insertSticker(sticker.src)}
                className="flex size-9 items-center justify-center rounded-md border border-black/15 p-1 hover:bg-black/5 pointer-coarse:size-11"
              >
                {/* Static bundled SVG art — a plain <img> is intentional here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sticker.src} alt="" className="size-full object-contain" />
              </button>
            ))}
          </div>

          {/* Clip-art palette — richer illustrated birthday artwork (distinct
              from the small Stickers above). Thumbnails are tiny WebPs; the
              full art (vector, or a print-grade WebP for the heavy pieces) is
              placed as an image at its true aspect ratio. */}
          <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-3">
            <span className="text-xs font-medium text-foreground/70">Clipart</span>
            {CLIPART_CATEGORIES.map((group) => (
              <div key={group.id} className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-foreground/45">
                  {group.label}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {group.items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      title={`Add ${item.label.toLowerCase()}`}
                      aria-label={`Add ${item.label.toLowerCase()} clipart`}
                      onClick={() => insertImage(item.src, item.width, item.height)}
                      className="flex size-12 items-center justify-center rounded-md border border-black/15 bg-white p-1 hover:ring-2 hover:ring-accent pointer-coarse:size-14"
                    >
                      {/* Bundled WebP thumbnail — a plain <img> is intentional. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.thumb}
                        alt=""
                        loading="lazy"
                        className="size-full object-contain"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {assets.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-3">
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
                      className="size-14 overflow-hidden rounded-md border border-black/10 hover:ring-2 hover:ring-accent"
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
                      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-black/10 bg-surface text-xs text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasQr && (
            <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 text-xs text-foreground/60">
              <span className="font-medium text-foreground">
                What plays when they scan this QR?
              </span>
              {/* Two ways to fill the QR (ADR 0137): a rich Message Page — the
                  first-class option — or, as a shortcut, just a video link that
                  auto-builds a simple page. Mode is derived from whether a page
                  is chosen. */}
              <div className="flex gap-2" role="group" aria-label="QR destination">
                <button
                  type="button"
                  onClick={() => {
                    setQrMode("page");
                    // Default to the first available page so the choice is
                    // immediately concrete; no-op if there are none yet.
                    setDocument((doc) => ({
                      ...doc,
                      messagePageId: doc.messagePageId ?? activeQrMessagePages[0]?.id ?? null,
                    }));
                  }}
                  aria-pressed={qrMode === "page"}
                  className={`rounded-md px-3 py-1 font-medium transition-colors ${
                    qrMode === "page"
                      ? "bg-foreground text-background"
                      : "border border-black/15 hover:bg-black/5"
                  }`}
                >
                  A message page
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQrMode("video");
                    // Clearing the page makes the video link the effective
                    // destination (page wins at settlement otherwise).
                    setDocument((doc) => ({ ...doc, messagePageId: null }));
                  }}
                  aria-pressed={qrMode === "video"}
                  className={`rounded-md px-3 py-1 font-medium transition-colors ${
                    qrMode === "video"
                      ? "bg-foreground text-background"
                      : "border border-black/15 hover:bg-black/5"
                  }`}
                >
                  Just a video link
                </button>
              </div>

              {qrMode === "page" ? (
                activeQrMessagePages.length > 0 ? (
                  <>
                    <select
                      // Fall back to the placeholder when the stored id no longer
                      // matches an active page (e.g. it was archived after
                      // linking) so the select never shows a phantom selection.
                      value={selectedQrMessagePage ? (document_.messagePageId ?? "") : ""}
                      onChange={(e) =>
                        setDocument((doc) => ({ ...doc, messagePageId: e.target.value || null }))
                      }
                      className="rounded-md border border-black/10 px-2 py-1 text-sm text-foreground"
                    >
                      {!selectedQrMessagePage && (
                        <option value="" disabled>
                          {document_.messagePageId
                            ? "Linked page unavailable — choose another"
                            : "Choose a message page…"}
                        </option>
                      )}
                      {activeQrMessagePages.map((mp) => (
                        <option key={mp.id} value={mp.id}>
                          {mp.emoji ? `${mp.emoji} ` : ""}
                          {mp.title}
                        </option>
                      ))}
                    </select>
                    {selectedQrMessagePage && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 rounded-md border border-black/10 bg-black/[0.02] p-2">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded bg-accent-soft text-base">
                            {selectedQrMessagePage.emoji ?? "💌"}
                          </span>
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className="truncate font-medium text-foreground">
                              {selectedQrMessagePage.title}
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {selectedQrMessagePage.videoProvider && (
                                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                                  Video
                                </span>
                              )}
                              {selectedQrMessagePage.hasCta && (
                                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                                  Button
                                </span>
                              )}
                              {selectedQrMessagePage.allowReplies && (
                                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                                  Replies
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <span className="text-foreground/60">
                          Every card from this design links to this page — you can change it per
                          recipient later on Messages.
                        </span>
                      </div>
                    )}
                    <a
                      href="/message-pages/new"
                      target="_blank"
                      rel="noreferrer"
                      className="w-fit text-accent hover:underline"
                    >
                      ＋ New message page
                    </a>
                  </>
                ) : (
                  <span>
                    {canAuthorMessagePages ? (
                      <a
                        href="/message-pages/new"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        Create a message page
                      </a>
                    ) : (
                      <a href="/billing" className="text-accent hover:underline">
                        Upgrade to add message pages
                      </a>
                    )}{" "}
                    to link a video and a personal note to this QR — or use just a video link below.
                  </span>
                )
              ) : (
                <label className="flex flex-col gap-1">
                  <input
                    type="url"
                    inputMode="url"
                    placeholder="https://youtu.be/…"
                    value={document_.videoUrl ?? ""}
                    onChange={(e) =>
                      setDocument((doc) => ({ ...doc, videoUrl: e.target.value || null }))
                    }
                    className="rounded-md border border-black/10 px-2 py-1 text-sm text-foreground"
                  />
                  <span>
                    We’ll build a simple page with just this video. It’s the default for every card
                    from this design — you can personalise it per contact later on the Messages
                    page.
                  </span>
                </label>
              )}
            </div>
          )}

          {/* The canvas scales itself to fit the container (see DesignCanvas),
              so the whole card shows and elements stay draggable on a phone —
              no horizontal scroll. */}
          <DesignCanvas
            page={page}
            selectedElementId={selectedElementId}
            lockImageAspect={lockImageAspect}
            onSelect={selectElement}
            onElementChange={updateElement}
            onDeselect={() => selectElement(null)}
            onSelectedOverflowChange={setSelectedOverflow}
            onReservedFooterOverlapChange={setReservedFooterOverlap}
          />
          {/* Always on while the back is open, not only once something strays into
              the strip: a customer should know the rule before they lay anything
              out, not be corrected afterwards. Neutral, because on its own this
              is information, not a problem. */}
          {activePage === "back" && (
            <p className="mt-2 rounded-md border border-black/10 bg-black/[0.03] px-3 py-2 text-xs text-muted">
              The bottom {BACK_RESERVED_FOOTER_MM}mm of the back is already printed on the card with
              the Kudos logo and QR code. Anything below the dashed line won’t be printed — drag
              content above it and it will snap into place.
            </p>
          )}
          {/* And amber once something actually is affected. A background is called
              out separately because it always covers the strip, so "move it up"
              is the wrong instruction — there is nothing to move. */}
          {activePage === "back" && (backHasBackground || reservedFooterOverlap) && (
            <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {backHasBackground && reservedFooterOverlap ? (
                <>
                  Your background stops at the dashed line, and something on this face reaches below
                  it. Move that content up; the background will simply end there.
                </>
              ) : backHasBackground ? (
                <>
                  Your background stops at the dashed line — it won’t reach the bottom of the card.
                  Keep anything that matters above it.
                </>
              ) : (
                <>Something on this face reaches below the dashed line and won’t be printed.</>
              )}
            </p>
          )}
        </div>

        <aside className="flex w-full flex-col gap-3 rounded-lg border border-black/10 p-4 sm:w-64 lg:sticky lg:top-4 lg:w-72 lg:self-start">
          {/* Page-level background (applies to the active face), independent of
              any element selection. */}
          <div className="flex flex-col gap-2 border-b border-black/10 pb-3">
            <span className="text-sm font-semibold">Background — {activePage}</span>
            <div className="flex gap-1">
              {(
                [
                  { type: "none", label: "None" },
                  { type: "color", label: "Colour" },
                  { type: "image", label: "Image" },
                ] as const
              ).map(({ type, label }) => {
                const active = (page.background?.type ?? "none") === type;
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={active}
                    disabled={type === "image" && bgUploading}
                    onClick={() => selectBackgroundType(type)}
                    className={`flex-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50 pointer-coarse:py-3.5 ${
                      active
                        ? "border-accent bg-accent/10 font-semibold text-foreground"
                        : "border-black/15 hover:bg-black/5"
                    }`}
                  >
                    {type === "image" && bgUploading ? "Uploading…" : label}
                  </button>
                );
              })}
            </div>
            {page.background?.type === "color" && (
              <input
                type="color"
                aria-label="Background colour"
                value={page.background.color}
                onChange={(e) => setPageBackground({ type: "color", color: e.target.value })}
                className="h-8 w-full rounded-md border border-black/10"
              />
            )}
            {page.background?.type === "image" && (
              <button
                type="button"
                disabled={bgUploading}
                onClick={() => bgFileInputRef.current?.click()}
                className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-50"
              >
                Replace background image
              </button>
            )}
            <input
              ref={bgFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleBackgroundUpload(file);
              }}
            />
          </div>

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
                  className="rounded-md border border-black/10 px-2 py-1 text-sm"
                />
              </label>
              {/* Insert a merge token at the caret — so designers pick "First
                  name" instead of remembering {"{firstName}"}. The select resets
                  to its placeholder after each pick so the same field can be
                  inserted again. */}
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Insert merge field — fills in per contact when sent
                <select
                  aria-label="Insert merge field"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) insertMergeField(e.target.value);
                  }}
                  className="rounded-md border border-black/10 px-2 py-1 text-sm"
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
                  className="rounded-md border border-black/10 px-2 py-1 text-sm"
                >
                  {FONT_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.fonts.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {/* Bold / italic / underline — map to Konva fontStyle +
                  textDecoration in both renderers (see konvaFontStyle). */}
              <div className="flex flex-col gap-1 text-xs text-foreground/60">
                Style
                <div className="flex gap-1">
                  {(
                    [
                      { key: "bold", label: "B", className: "font-bold" },
                      { key: "italic", label: "I", className: "italic" },
                      { key: "underline", label: "U", className: "underline" },
                    ] as const
                  ).map(({ key, label, className }) => {
                    const active = Boolean(selectedElement[key]);
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        aria-label={key}
                        onClick={() => updateElement({ ...selectedElement, [key]: !active })}
                        className={`flex-1 rounded-md border px-2 py-1 text-sm pointer-coarse:py-3.5 ${className} ${
                          active
                            ? "border-accent bg-accent/10 font-semibold text-foreground"
                            : "border-black/15 hover:bg-black/5"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
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
                  className="rounded-md border border-black/10 px-2 py-1 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Colour
                <input
                  type="color"
                  value={selectedElement.color}
                  onChange={(e) => updateElement({ ...selectedElement, color: e.target.value })}
                  className="h-8 w-full rounded-md border border-black/10"
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
                      const next =
                        raw === ""
                          ? undefined
                          : Math.min(CARD_WIDTH, Math.max(40, Number(raw) || 40));
                      updateElement({ ...selectedElement, width: next });
                    }}
                    className="w-full rounded-md border border-black/10 px-2 py-1 text-sm"
                  />
                  {selectedElement.width !== undefined && (
                    <button
                      type="button"
                      onClick={() => updateElement({ ...selectedElement, width: undefined })}
                      className="shrink-0 rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5"
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
                        className={`flex-1 rounded-md border px-2 py-1 text-xs capitalize pointer-coarse:py-3.5 ${
                          active
                            ? "border-accent bg-accent/10 font-semibold text-foreground"
                            : "border-black/15 hover:bg-black/5"
                        }`}
                      >
                        {align}
                      </button>
                    );
                  })}
                </div>
              </div>
              {selectedOverflow && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                  This text spills outside the card’s safe area (the dashed frame). Shorten it,
                  shrink the font, or narrow the box so it isn’t clipped when printed.
                </p>
              )}
            </>
          )}

          {selectedElement?.kind === "image" && (
            <>
              {selectedImageDpi !== null &&
                (() => {
                  const verdict = printDpiVerdict(selectedImageDpi);
                  if (verdict === "ok") {
                    return (
                      <p className="text-[11px] text-emerald-700">
                        Print resolution: ~{Math.round(selectedImageDpi)} dpi ✓
                      </p>
                    );
                  }
                  const low = verdict === "low";
                  return (
                    <div
                      className={`rounded-md border px-2 py-1.5 text-[11px] ${
                        low
                          ? "border-red-300 bg-red-50 text-red-800"
                          : "border-amber-300 bg-amber-50 text-amber-900"
                      }`}
                    >
                      <p className="font-medium">
                        {low ? "⚠ Low print resolution" : "Print resolution a little low"} — ~
                        {Math.round(selectedImageDpi)} dpi
                      </p>
                      <p className="mt-0.5">
                        {low
                          ? `This image may look soft when printed. Use a higher-resolution image, or make it smaller on the card. We recommend ${PRINT_DPI_TARGET} dpi.`
                          : `A touch below the ${PRINT_DPI_TARGET} dpi ideal — usually still fine, but a larger image or smaller placement would be crisper.`}
                      </p>
                    </div>
                  );
                })()}
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
                      ? Math.max(
                          1,
                          Math.round(width * (selectedElement.height / selectedElement.width)),
                        )
                      : selectedElement.height;
                    updateElement({ ...selectedElement, width, height });
                  }}
                  className="rounded-md border border-black/10 px-2 py-1 text-sm"
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
                      ? Math.max(
                          1,
                          Math.round(height * (selectedElement.width / selectedElement.height)),
                        )
                      : selectedElement.width;
                    updateElement({ ...selectedElement, width, height });
                  }}
                  className="rounded-md border border-black/10 px-2 py-1 text-sm"
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
                  className="rounded-md border border-black/10 px-2 py-1 text-sm"
                />
              </label>
            </>
          )}

          {selectedElement?.kind === "qr" && (
            <>
              <p className="text-xs text-foreground/60">
                A QR code recipients scan to open their message page. Choose what it links to in
                “What plays when they scan this QR?” above, drag it on the card to position it, and
                size it here.
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
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-black/15 text-xl hover:bg-black/5"
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
                    className="h-11 w-16 rounded-md border border-black/10 px-2 text-center text-sm"
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
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-black/15 text-xl hover:bg-black/5"
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
                className="flex h-11 items-center justify-center gap-2 rounded-md border border-black/15 text-sm hover:bg-black/5"
              >
                Rotate 90°
                <span className="text-foreground/50">{selectedElement.rotation}°</span>
              </button>
            </>
          )}

          {selectedElement?.kind === "shape" && (
            <>
              {selectedElement.shape !== "line" && (
                <label className="flex flex-col gap-1 text-xs text-foreground/60">
                  Fill
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Fill colour"
                      value={selectedElement.fill ?? "#93c5fd"}
                      onChange={(e) => updateElement({ ...selectedElement, fill: e.target.value })}
                      className="h-8 flex-1 rounded-md border border-black/10"
                    />
                    <button
                      type="button"
                      onClick={() => updateElement({ ...selectedElement, fill: undefined })}
                      className="shrink-0 rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5"
                    >
                      None
                    </button>
                  </div>
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                {selectedElement.shape === "line" ? "Line colour" : "Border colour"}
                <input
                  type="color"
                  aria-label="Stroke colour"
                  value={selectedElement.stroke ?? "#111111"}
                  onChange={(e) =>
                    updateElement({
                      ...selectedElement,
                      stroke: e.target.value,
                      // Give a border an actual width the first time a colour is
                      // picked, so it shows immediately (and the width field agrees).
                      strokeWidth: selectedElement.strokeWidth ?? 2,
                    })
                  }
                  className="h-8 w-full rounded-md border border-black/10"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                {selectedElement.shape === "line" ? "Thickness" : "Border width"}
                <input
                  type="number"
                  min={0}
                  max={40}
                  value={selectedElement.strokeWidth ?? (selectedElement.shape === "line" ? 4 : 0)}
                  onChange={(e) =>
                    updateElement({
                      ...selectedElement,
                      strokeWidth: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="rounded-md border border-black/10 px-2 py-1 text-sm"
                />
              </label>
              {selectedElement.shape === "rect" && (
                <label className="flex flex-col gap-1 text-xs text-foreground/60">
                  Corner radius
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={selectedElement.cornerRadius ?? 0}
                    onChange={(e) =>
                      updateElement({
                        ...selectedElement,
                        cornerRadius: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="rounded-md border border-black/10 px-2 py-1 text-sm"
                  />
                </label>
              )}
            </>
          )}

          {selectedElement && (
            <div className="mt-2 flex flex-col gap-2">
              {/* Layer order — the array order is the stacking order (later draws
                  on top). Disabled at the ends so a no-op reads as unavailable. */}
              {page.elements.length > 1 && (
                <div className="flex flex-col gap-1 text-xs text-foreground/60">
                  Layer
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => reorderSelected("back")}
                      disabled={isBackmost}
                      title="Send to back"
                      className="flex-1 rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-40 pointer-coarse:py-3.5"
                    >
                      To back
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderSelected("backward")}
                      disabled={isBackmost}
                      title="Send backward (⌘/Ctrl+[)"
                      className="flex-1 rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-40 pointer-coarse:py-3.5"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderSelected("forward")}
                      disabled={isFrontmost}
                      title="Bring forward (⌘/Ctrl+])"
                      className="flex-1 rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-40 pointer-coarse:py-3.5"
                    >
                      Forward
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderSelected("front")}
                      disabled={isFrontmost}
                      title="Bring to front"
                      className="flex-1 rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-40 pointer-coarse:py-3.5"
                    >
                      To front
                    </button>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={duplicateSelected}
                  className="flex-1 rounded-full border border-black/15 px-4 py-2 text-sm hover:bg-black/5"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="flex-1 rounded-full border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
              {/* Discoverability for the on-canvas handles + shortcuts. */}
              <p className="text-[11px] text-foreground/50">
                Drag the handles to resize or rotate. Dragging snaps to the card centre, safe
                margins, and other elements — hold Alt to move freely. Arrow keys nudge ·
                Shift+arrows move further · ⌘/Ctrl+D duplicates · ⌘/Ctrl+]/[ change layer order ·
                Delete removes · Esc deselects.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
