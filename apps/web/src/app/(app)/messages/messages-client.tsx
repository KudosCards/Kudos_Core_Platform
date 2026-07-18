"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { createClient } from "@/lib/supabase/client";
import { OCCASION_TYPE_LABELS } from "@/lib/occasions";

export interface AccountMessagePage {
  id: string;
  slug: string;
  message: string | null;
  emoji: string | null;
  videoUrl: string | null;
  viewCount: number;
  orderRecipient: {
    recipient: { firstName: string; lastName: string };
    occasion: { type: string } | null;
  };
}

interface SignedUpload {
  path: string;
  token: string;
  publicUrl: string;
}

const MESSAGE_VIDEOS_BUCKET = "message-videos";

export function MessagesClient({ initialPages }: { initialPages: AccountMessagePage[] }) {
  const [pages, setPages] = useState(initialPages);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  function patchLocal(id: string, patch: Partial<AccountMessagePage>) {
    setPages((current) => current.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function save(page: AccountMessagePage) {
    setError(null);
    setSavingId(page.id);
    try {
      const updated = await clientApiFetch<AccountMessagePage>(`/messages/${page.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          message: page.message ?? null,
          emoji: page.emoji ?? null,
          videoUrl: page.videoUrl ?? null,
        }),
      });
      patchLocal(page.id, updated);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save");
    } finally {
      setSavingId(null);
    }
  }

  async function uploadVideo(page: AccountMessagePage, file: File) {
    setError(null);
    setUploadingId(page.id);
    try {
      const signed = await clientApiFetch<SignedUpload>("/uploads/message-videos", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(MESSAGE_VIDEOS_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (uploadError) {
        throw new Error(uploadError.message);
      }
      patchLocal(page.id, { videoUrl: signed.publicUrl });
    } catch (uploadCatchError) {
      setError(uploadCatchError instanceof Error ? uploadCatchError.message : "Upload failed");
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Message pages</h1>
        <p className="text-muted">
          Add a message, emoji, or video to each card&apos;s QR page. Recipients scan the code on
          their card to see it.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      {pages.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">
          No message pages yet — they&apos;re created automatically once a card order is paid.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {pages.map((page) => {
            const publicUrl = `/r/${page.slug}`;
            return (
              <div key={page.id} className="card flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">
                      {page.orderRecipient.recipient.firstName}{" "}
                      {page.orderRecipient.recipient.lastName}
                      {page.orderRecipient.occasion && (
                        <span className="text-muted">
                          {" · "}
                          {OCCASION_TYPE_LABELS[page.orderRecipient.occasion.type] ??
                            page.orderRecipient.occasion.type}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {page.viewCount} view{page.viewCount === 1 ? "" : "s"} ·{" "}
                      <a
                        href={publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        open page
                      </a>
                    </p>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <textarea
                    placeholder="Write a message…"
                    value={page.message ?? ""}
                    maxLength={2000}
                    onChange={(e) => patchLocal(page.id, { message: e.target.value })}
                    className="min-h-20 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                  />
                  <div className="flex flex-col gap-2">
                    <input
                      placeholder="Emoji"
                      value={page.emoji ?? ""}
                      maxLength={8}
                      onChange={(e) => patchLocal(page.id, { emoji: e.target.value })}
                      className="w-24 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    />
                    <label className="cursor-pointer rounded-md border border-border px-3 py-2 text-center text-xs hover:bg-foreground/[0.03]">
                      {uploadingId === page.id
                        ? "Uploading…"
                        : page.videoUrl
                          ? "Replace video"
                          : "Add video"}
                      <input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        className="hidden"
                        disabled={uploadingId === page.id}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadVideo(page, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>

                {page.videoUrl && <p className="text-xs text-muted">Video attached.</p>}

                <button
                  type="button"
                  disabled={savingId === page.id}
                  onClick={() => void save(page)}
                  className="btn-accent self-start"
                >
                  {savingId === page.id ? "Saving…" : "Save"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
