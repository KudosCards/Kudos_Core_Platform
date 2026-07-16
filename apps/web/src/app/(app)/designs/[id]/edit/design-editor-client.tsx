"use client";

import type { DesignDocument, DesignElement, DesignPage, SavedDesign } from "@kudos/shared-types";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { createClient } from "@/lib/supabase/client";

const DesignCanvas = dynamic(() => import("./design-canvas").then((mod) => mod.DesignCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-[600px] w-[450px] items-center justify-center rounded-md border border-black/10 text-sm text-foreground/50 dark:border-white/10">
      Loading canvas…
    </div>
  ),
});

const PAGE_NAMES: DesignPage["name"][] = ["front", "inside-left", "inside-right", "back"];
const FONT_OPTIONS = ["Georgia", "Helvetica", "Times New Roman", "Courier New"];

interface SignedUpload {
  path: string;
  token: string;
  publicUrl: string;
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

export function DesignEditorClient({ savedDesign }: { savedDesign: SavedDesign }) {
  const [name, setName] = useState(savedDesign.name);
  const [document_, setDocument] = useState<DesignDocument>(savedDesign.document);
  const [activePage, setActivePage] = useState<DesignPage["name"]>("front");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const page = document_.pages.find((p) => p.name === activePage) ?? document_.pages[0]!;
  const selectedElement = page.elements.find((el) => el.id === selectedElementId) ?? null;

  function updatePage(pageName: DesignPage["name"], updater: (page: DesignPage) => DesignPage) {
    setDocument((doc) => ({
      ...doc,
      pages: doc.pages.map((p) => (p.name === pageName ? updater(p) : p)),
    }));
  }

  function addTextElement() {
    const element = newTextElement();
    updatePage(activePage, (p) => ({ ...p, elements: [...p.elements, element] }));
    setSelectedElementId(element.id);
  }

  function updateElement(updated: DesignElement) {
    updatePage(activePage, (p) => ({
      ...p,
      elements: p.elements.map((el) => (el.id === updated.id ? updated : el)),
    }));
  }

  function deleteSelected() {
    if (!selectedElementId) return;
    updatePage(activePage, (p) => ({
      ...p,
      elements: p.elements.filter((el) => el.id !== selectedElementId),
    }));
    setSelectedElementId(null);
  }

  async function handleImageUpload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const signed = await clientApiFetch<SignedUpload>("/uploads/design-assets", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("design-assets")
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const element: Extract<DesignElement, { kind: "image" }> = {
        kind: "image",
        id: crypto.randomUUID(),
        assetUrl: signed.publicUrl,
        x: 40,
        y: 40,
        width: 150,
        height: 150,
        rotation: 0,
      };
      updatePage(activePage, (p) => ({ ...p, elements: [...p.elements, element] }));
      setSelectedElementId(element.id);
    } catch (uploadCatchError) {
      setError(uploadCatchError instanceof Error ? uploadCatchError.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await clientApiFetch<SavedDesign>(`/saved-designs/${savedDesign.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, document: document_ }),
      });
      setSavedAt(new Date());
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-black/10 px-3 py-2 text-lg font-semibold dark:border-white/10"
        />
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="text-xs text-foreground/50">Saved {savedAt.toLocaleTimeString()}</span>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-full bg-foreground px-5 py-2 text-sm text-background hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2 border-b border-black/10 pb-2 dark:border-white/10">
        {PAGE_NAMES.map((pageName) => (
          <button
            key={pageName}
            type="button"
            onClick={() => {
              setActivePage(pageName);
              setSelectedElementId(null);
            }}
            className={`rounded-full px-3 py-1.5 text-sm ${
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
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addTextElement}
              className="rounded-full border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/5"
            >
              Add text
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5"
            >
              {uploading ? "Uploading…" : "Add image"}
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

          <DesignCanvas
            page={page}
            selectedElementId={selectedElementId}
            onSelect={setSelectedElementId}
            onElementChange={updateElement}
            onDeselect={() => setSelectedElementId(null)}
          />
        </div>

        <aside className="flex w-64 flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
          <h2 className="text-sm font-semibold">
            {selectedElement ? "Selected element" : "Nothing selected"}
          </h2>

          {selectedElement?.kind === "text" && (
            <>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Text (supports {"{name}"})
                <textarea
                  value={selectedElement.text}
                  onChange={(e) => updateElement({ ...selectedElement, text: e.target.value })}
                  rows={3}
                  className="rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/10"
                />
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
            </>
          )}

          {selectedElement?.kind === "image" && (
            <>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Width
                <input
                  type="number"
                  min={10}
                  value={selectedElement.width}
                  onChange={(e) =>
                    updateElement({ ...selectedElement, width: Number(e.target.value) || 1 })
                  }
                  className="rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/10"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-foreground/60">
                Height
                <input
                  type="number"
                  min={10}
                  value={selectedElement.height}
                  onChange={(e) =>
                    updateElement({ ...selectedElement, height: Number(e.target.value) || 1 })
                  }
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

          {selectedElement && (
            <button
              type="button"
              onClick={deleteSelected}
              className="mt-2 rounded-full border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
            >
              Delete
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
