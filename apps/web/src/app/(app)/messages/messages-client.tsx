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
      <div>
        <h1 className="text-2xl font-semibold">Message pages</h1>
        <p className="text-foreground/60">
          Add a message, emoji, or video to each card&apos;s QR page. Recipients scan the code on
          their card to see it.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {pages.length === 0 ? (
        <p className="text-sm text-foreground/60">
          No message pages yet — they&apos;re created automatically once a card order is paid.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {pages.map((page) => {
            const publicUrl = `/r/${page.slug}`;
            return (
              <div
                key={page.id}
                className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {page.orderRecipient.recipient.firstName}{" "}
                      {page.orderRecipient.recipient.lastName}
                      {page.orderRecipient.occasion && (
                        <span className="text-foreground/60">
                          {" · "}
                          {OCCASION_TYPE_LABELS[page.orderRecipient.occasion.type] ??
                            page.orderRecipient.occasion.type}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-foreground/50">
                      {page.viewCount} view{page.viewCount === 1 ? "" : "s"} ·{" "}
                      <a href={publicUrl} target="_blank" rel="noreferrer" className="underline">
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
                    className="min-h-20 rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
                  />
                  <div className="flex flex-col gap-2">
                    <input
                      placeholder="Emoji"
                      value={page.emoji ?? ""}
                      maxLength={8}
                      onChange={(e) => patchLocal(page.id, { emoji: e.target.value })}
                      className="w-24 rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
                    />
                    <label className="cursor-pointer rounded-md border border-black/20 px-3 py-2 text-center text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/5">
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

                {page.videoUrl && <p className="text-xs text-foreground/50">Video attached.</p>}

                <button
                  type="button"
                  disabled={savingId === page.id}
                  onClick={() => void save(page)}
                  className="self-start rounded-full bg-foreground px-4 py-1.5 text-sm text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
