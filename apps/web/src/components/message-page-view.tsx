/**
 * The mobile message-page card — the single visual shared by the public
 * `/r/[slug]` page (server-rendered from sanitised API data) and the builder's
 * live preview (client-rendered from the in-progress form). Keeping one
 * component means the author sees exactly what the recipient will (ADR 0132).
 *
 * `messageHtml` is rendered with dangerouslySetInnerHTML: on the public page it
 * is the API's server-sanitised HTML; in the builder preview it is the
 * rich-text editor's own output, which only ever emits the allowlisted tags.
 */
export interface MessagePageViewProps {
  emoji: string | null;
  title: string | null;
  greetingName?: string | null;
  /** iframe src for an embedded provider video. */
  embedUrl: string | null;
  /** direct file URL for a legacy uploaded video. */
  videoUrl: string | null;
  messageHtml: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  /** When set, the CTA links here instead of straight to `ctaUrl` — the public
   * page passes a click-tracking redirect; the builder preview omits it. */
  ctaHref?: string | null;
}

export function MessagePageView({
  emoji,
  title,
  greetingName,
  embedUrl,
  videoUrl,
  messageHtml,
  ctaLabel,
  ctaUrl,
  ctaHref,
}: MessagePageViewProps) {
  const hasContent = emoji || title || embedUrl || videoUrl || messageHtml || (ctaLabel && ctaUrl);

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      {emoji && <div className="text-6xl leading-none sm:text-7xl">{emoji}</div>}

      {title && (
        <h1 className="text-3xl font-bold tracking-tight text-balance break-words sm:text-4xl">
          {title}
        </h1>
      )}

      {greetingName && <p className="-mt-3 text-base font-medium text-muted">For {greetingName}</p>}

      {embedUrl && (
        <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black/5 shadow-sm">
          <iframe
            src={embedUrl}
            title="Message video"
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {!embedUrl && videoUrl && (
        <video
          controls
          playsInline
          src={videoUrl}
          className="aspect-video w-full rounded-xl border border-border bg-black/5 shadow-sm"
        />
      )}

      {messageHtml && (
        <div
          className="w-full break-words text-left text-lg leading-relaxed text-foreground/80 [&_a]:break-words [&_a]:text-accent [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6"
          dangerouslySetInnerHTML={{ __html: messageHtml }}
        />
      )}

      {ctaLabel && ctaUrl && (
        <a
          href={ctaHref ?? ctaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          {ctaLabel}
        </a>
      )}

      {!hasContent && (
        <p className="text-muted">
          Your card is on its way — a personal message will appear here soon.
        </p>
      )}
    </div>
  );
}
