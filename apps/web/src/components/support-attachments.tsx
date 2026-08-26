"use client";

import { Film, Image as ImageIcon } from "lucide-react";
import { useId, useRef, useState, type ChangeEvent } from "react";
import {
  SUPPORT_MAX_ATTACHMENTS,
  type SupportAttachment,
  type SupportAttachmentInput,
} from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { createClient } from "@/lib/supabase/client";

/** Mirrors the API's SignedUpload response. */
interface SignedUpload {
  path: string;
  token: string;
  publicUrl: string;
}

const SUPPORT_ATTACHMENTS_BUCKET = "support-attachments";
const MAX_BYTES = 50 * 1024 * 1024; // matches the bucket's 50MB limit

function kindOf(contentType: string): SupportAttachment["kind"] | null {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Screenshot + screen-recording picker for the support form and replies. Each
 * chosen file is uploaded to storage immediately (signed URL → Supabase), and
 * the resulting file references are surfaced via `onChange` for the parent to
 * submit with the message. See ADR 0079.
 */
export function SupportAttachmentsInput({
  value,
  onChange,
  onBusyChange,
  disabled,
}: {
  value: SupportAttachmentInput[];
  onChange: (next: SupportAttachmentInput[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const remaining = SUPPORT_MAX_ATTACHMENTS - value.length;

  function setBusy(delta: number) {
    setUploading((n) => {
      const next = n + delta;
      onBusyChange?.(next > 0);
      return next;
    });
  }

  async function uploadOne(file: File): Promise<SupportAttachmentInput | null> {
    const kind = kindOf(file.type);
    if (!kind) {
      setError(`${file.name}: only images and videos can be attached.`);
      return null;
    }
    if (file.size > MAX_BYTES) {
      setError(`${file.name} is too large (max ${formatBytes(MAX_BYTES)}).`);
      return null;
    }
    const signed = await clientApiFetch<SignedUpload>("/uploads/support-attachments", {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, contentType: file.type }),
    });
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(SUPPORT_ATTACHMENTS_BUCKET)
      .uploadToSignedUrl(signed.path, signed.token, file);
    if (uploadError) throw new Error(uploadError.message);
    return {
      // The storage path, not a URL: the bucket is private, so the API mints a
      // signed read URL per request. It also checks this path belongs to the
      // caller's account before storing it.
      path: signed.path,
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      kind,
    };
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, remaining);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;
    setError(null);
    setBusy(files.length);
    try {
      for (const file of files) {
        try {
          const added = await uploadOne(file);
          if (added) onChange([...value, added]);
        } catch (uploadError) {
          setError(
            uploadError instanceof ApiError
              ? uploadError.message
              : `Could not upload ${file.name}.`,
          );
        } finally {
          setBusy(-1);
        }
      }
    } catch {
      // Guarded per-file above; nothing else to do.
    }
  }

  /** Identity of a not-yet-submitted attachment. `path` is what this build
   *  sends; `url` is the legacy field, kept so the shared type stays honest. */
  function refOf(a: SupportAttachmentInput): string {
    return a.path ?? a.url ?? a.fileName;
  }

  function remove(ref: string) {
    onChange(value.filter((a) => refOf(a) !== ref));
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        Add a screenshot or screen recording{" "}
        <span className="font-normal text-muted">(optional — a picture says a lot)</span>
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={(event) => void handleFiles(event)}
        disabled={disabled || uploading > 0 || remaining <= 0}
        className="block w-full cursor-pointer rounded-md border border-border bg-surface text-sm text-muted file:mr-3 file:cursor-pointer file:border-0 file:bg-accent file:px-4 file:py-2 file:font-medium file:text-white hover:file:bg-accent-hover disabled:opacity-50"
      />
      <p className="text-xs text-muted">
        Up to {SUPPORT_MAX_ATTACHMENTS} files, {formatBytes(MAX_BYTES)} each. Record your screen
        with your phone or a tool like Loom, then upload the file here.
      </p>
      {uploading > 0 && <p className="text-xs text-muted">Uploading…</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
      {value.length > 0 && (
        <ul className="flex flex-col gap-1">
          {value.map((a) => (
            <li
              key={refOf(a)}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                {a.kind === "video" ? (
                  <Film className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <ImageIcon className="h-4 w-4 shrink-0" aria-hidden />
                )}
                <span className="truncate">{a.fileName}</span>
                <span className="shrink-0 text-xs text-muted">{formatBytes(a.sizeBytes)}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(refOf(a))}
                disabled={disabled}
                className="shrink-0 text-muted hover:text-accent"
                aria-label={`Remove ${a.fileName}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Renders a message's attachments in a thread — image thumbnails (click to open
 * full size) and inline video players, with a download link. */
export function SupportAttachmentList({ attachments }: { attachments: SupportAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((a) =>
        a.kind === "image" ? (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${a.fileName} (${formatBytes(a.sizeBytes)})`}
            className="block overflow-hidden rounded-md border border-border"
          >
            {/* Plain img: a support thumbnail doesn't need the image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.fileName} className="h-28 w-auto max-w-[200px] object-cover" />
          </a>
        ) : (
          <video
            key={a.id}
            src={a.url}
            controls
            preload="metadata"
            className="max-h-64 w-full max-w-sm rounded-md border border-border"
          />
        ),
      )}
    </div>
  );
}
