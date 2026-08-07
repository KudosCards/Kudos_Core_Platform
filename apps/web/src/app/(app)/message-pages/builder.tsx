"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MESSAGE_PAGE_LIMITS,
  parseVideoEmbed,
  VIDEO_PROVIDER_LABELS,
  type MessagePageDetail,
} from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { qrDataUrl } from "@/lib/qr";
import { MessagePageView } from "@/components/message-page-view";
import { RichTextEditor } from "./rich-text-editor";
import { RepliesPanel } from "./replies-panel";

const INPUT = "w-full rounded-md border border-border bg-surface px-3 py-2.5 text-base sm:text-sm";

const EMOJI_CHOICES = [
  "🎉", "🎂", "🎈", "🥳", "🎁", "👏", "🙌", "💐", "🌟", "✨",
  "❤️", "💙", "🏆", "🎓", "☀️", "🙏", "🤝", "💌", "🎊", "🕊️",
];

interface FormState {
  title: string;
  emoji: string | null;
  videoUrl: string;
  message: string;
  ctaLabel: string;
  ctaUrl: string;
  allowReplies: boolean;
  recipientName: string;
}

function toForm(page: MessagePageDetail | null): FormState {
  return {
    title: page?.title ?? "",
    emoji: page?.emoji ?? null,
    videoUrl: page?.videoUrl ?? "",
    message: page?.message ?? "",
    ctaLabel: page?.ctaLabel ?? "",
    ctaUrl: page?.ctaUrl ?? "",
    allowReplies: page?.allowReplies ?? false,
    recipientName: page?.recipientName ?? "",
  };
}

/** Trim + null-empty a value for the API's "clear this field" convention. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function MessagePageBuilder({ page }: { page: MessagePageDetail | null }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toForm(page));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Live embed preview, mirroring the API's embed-only rule via the shared helper.
  const embed = useMemo(
    () => (form.videoUrl.trim() ? parseVideoEmbed(form.videoUrl) : null),
    [form.videoUrl],
  );
  const videoWarning = form.videoUrl.trim() && !embed;

  const ctaHalf = Boolean(form.ctaLabel.trim()) !== Boolean(form.ctaUrl.trim());

  async function save() {
    setError(null);
    if (!form.title.trim()) {
      setError("Give your page a title.");
      return;
    }
    if (videoWarning) {
      setError("That video link isn't from a supported provider (YouTube, Vimeo, Loom or Google Drive).");
      return;
    }
    if (ctaHalf) {
      setError("A call-to-action needs both a button label and an https link.");
      return;
    }
    const body = {
      title: form.title.trim(),
      emoji: form.emoji,
      videoUrl: orNull(form.videoUrl),
      message: orNull(form.message),
      ctaLabel: orNull(form.ctaLabel),
      ctaUrl: orNull(form.ctaUrl),
      allowReplies: form.allowReplies,
      recipientName: orNull(form.recipientName),
    };
    setSaving(true);
    try {
      if (page) {
        await clientApiFetch<MessagePageDetail>(`/message-pages/${page.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        router.refresh();
      } else {
        const created = await clientApiFetch<MessagePageDetail>("/message-pages", {
          method: "POST",
          body: JSON.stringify(body),
        });
        router.push(`/message-pages/${created.id}`);
        return;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your page. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!page) return;
    if (!window.confirm("Archive this page? Any cards already sent keep working; it just leaves your library.")) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await clientApiFetch(`/message-pages/${page.id}`, { method: "DELETE" });
      router.push("/message-pages");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't archive this page.");
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* Editor */}
      <div className="flex flex-col gap-6">
        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <Field label="Title" hint={`${form.title.length}/${MESSAGE_PAGE_LIMITS.title}`}>
          <input
            type="text"
            value={form.title}
            maxLength={MESSAGE_PAGE_LIMITS.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="A message for you"
            className={INPUT}
          />
        </Field>

        <Field label="Icon" hint="Shown large at the top">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => set("emoji", null)}
              className={`flex size-9 items-center justify-center rounded-lg border text-sm ${
                form.emoji === null
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-muted hover:bg-foreground/[0.04]"
              }`}
            >
              None
            </button>
            {EMOJI_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => set("emoji", emoji)}
                aria-pressed={form.emoji === emoji}
                className={`flex size-9 items-center justify-center rounded-lg border text-lg ${
                  form.emoji === emoji
                    ? "border-accent bg-accent-soft"
                    : "border-border hover:bg-foreground/[0.04]"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Video link"
          hint="YouTube, Vimeo, Loom or Google Drive"
        >
          <input
            type="url"
            value={form.videoUrl}
            onChange={(e) => set("videoUrl", e.target.value)}
            placeholder="https://youtu.be/…"
            className={INPUT}
          />
          {embed && (
            <p className="mt-1 text-xs text-success">✓ {VIDEO_PROVIDER_LABELS[embed.provider]} video</p>
          )}
          {videoWarning && (
            <p className="mt-1 text-xs text-danger">
              That link isn&apos;t from a supported provider.
            </p>
          )}
        </Field>

        <Field label="Message">
          <RichTextEditor
            initialHtml={form.message}
            onChange={(html) => set("message", html)}
            placeholder="Write a personal message…"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Button label" hint="Optional">
            <input
              type="text"
              value={form.ctaLabel}
              maxLength={MESSAGE_PAGE_LIMITS.ctaLabel}
              onChange={(e) => set("ctaLabel", e.target.value)}
              placeholder="Visit our site"
              className={INPUT}
            />
          </Field>
          <Field label="Button link" hint="https:// only">
            <input
              type="url"
              value={form.ctaUrl}
              onChange={(e) => set("ctaUrl", e.target.value)}
              placeholder="https://…"
              className={INPUT}
            />
          </Field>
        </div>
        {ctaHalf && (
          <p className="-mt-3 text-xs text-danger">Add both a label and a link, or leave both blank.</p>
        )}

        <Field label="Greeting name" hint="Used when this page isn't tied to a contact">
          <input
            type="text"
            value={form.recipientName}
            maxLength={MESSAGE_PAGE_LIMITS.recipientName}
            onChange={(e) => set("recipientName", e.target.value)}
            placeholder="e.g. the team"
            className={INPUT}
          />
        </Field>

        <label className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
          <input
            type="checkbox"
            checked={form.allowReplies}
            onChange={(e) => set("allowReplies", e.target.checked)}
            className="size-4"
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">Allow replies</span>
            <span className="text-xs text-muted">Recipients can write back — coming soon.</span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-accent"
          >
            {saving ? "Saving…" : page ? "Save changes" : "Create page"}
          </button>
          {page && (
            <button
              type="button"
              onClick={archive}
              disabled={saving}
              className="text-sm font-medium text-danger hover:underline"
            >
              Archive page
            </button>
          )}
        </div>
      </div>

      {/* Live preview + QR */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <p className="section-label mb-2">Preview</p>
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-surface px-4 py-8">
          <MessagePageView
            emoji={form.emoji}
            title={form.title.trim() || "A message for you"}
            greetingName={form.recipientName.trim() || null}
            embedUrl={embed?.embedUrl ?? null}
            videoUrl={null}
            messageHtml={orNull(form.message)}
            ctaLabel={orNull(form.ctaLabel)}
            ctaUrl={orNull(form.ctaUrl)}
          />
        </div>
        {page?.primarySlug && <QrPanel slug={page.primarySlug} stats={page} />}
        {page && (page.allowReplies || page.replyCount > 0) && <RepliesPanel pageId={page.id} />}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-medium">{label}</label>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function QrPanel({ slug, stats }: { slug: string; stats: MessagePageDetail }) {
  const [dataUrl, setDataUrl] = useState("");
  useMemo(() => {
    const url = `${window.location.origin}/r/${slug}`;
    void qrDataUrl(url).then(setDataUrl);
  }, [slug]);

  return (
    <div className="mt-4 flex items-center gap-4 rounded-2xl border border-border bg-surface p-4">
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- data-URL QR
        <img src={dataUrl} alt="QR code for this page" width={80} height={80} className="rounded-md border border-border" />
      ) : (
        <div className="size-20 shrink-0 animate-pulse rounded-md bg-foreground/5" />
      )}
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium">Its own QR code</p>
        <p className="text-xs text-muted">
          {stats.linkCount} {stats.linkCount === 1 ? "card" : "cards"} · {stats.totalViews}{" "}
          {stats.totalViews === 1 ? "view" : "views"}
        </p>
        {dataUrl && (
          <a href={dataUrl} download={`kudos-qr-${slug}.png`} className="text-xs text-accent hover:underline">
            Download QR
          </a>
        )}
      </div>
    </div>
  );
}
