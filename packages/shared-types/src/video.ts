/**
 * Video embed parsing for Message Pages (ADR 0132). A page's video can be a
 * pasted link from a small allowlist of providers; we NEVER iframe an arbitrary
 * URL. This single helper is the source of truth for both the API (validate on
 * save) and the web builder (live preview), so they can't drift.
 *
 * Given a user-pasted URL it returns the provider, the canonical privacy-friendly
 * **embed** URL to put in an <iframe>, and the extracted id — or `null` if the URL
 * isn't a recognised, embeddable video (in which case the caller rejects it).
 */

export const VIDEO_EMBED_PROVIDERS = ["youtube", "vimeo", "loom", "google_drive"] as const;
export type VideoEmbedProvider = (typeof VIDEO_EMBED_PROVIDERS)[number];

export interface VideoEmbed {
  provider: VideoEmbedProvider;
  /** The canonical URL to place in an <iframe src>. */
  embedUrl: string;
  /** The provider's id for the video (kept for reference / analytics). */
  videoId: string;
}

/** Human labels for the allowlist, e.g. for builder help text. */
export const VIDEO_PROVIDER_LABELS: Record<VideoEmbedProvider, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  loom: "Loom",
  google_drive: "Google Drive",
};

/** Parse a URL safely; returns null for anything that isn't a valid http(s) URL. */
function toUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/** host === base or a subdomain of base (e.g. "www.youtube.com" for "youtube.com"). */
function hostIs(url: URL, base: string): boolean {
  const host = url.hostname.toLowerCase();
  return host === base || host.endsWith(`.${base}`);
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;
const NUMERIC_ID = /^\d{4,}$/;
const LOOM_ID = /^[A-Za-z0-9]{16,}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

/**
 * Recognise a pasted video URL and return its canonical embed form, or null.
 * Supported: YouTube (incl. youtu.be / shorts / embed), Vimeo, Loom, Google Drive.
 */
export function parseVideoEmbed(raw: string): VideoEmbed | null {
  const url = toUrl(raw);
  if (!url) return null;
  const path = url.pathname;

  // YouTube — watch?v=, youtu.be/<id>, /shorts/<id>, /embed/<id>.
  if (hostIs(url, "youtube.com") || hostIs(url, "youtube-nocookie.com")) {
    const fromQuery = url.searchParams.get("v");
    const fromPath = path.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1];
    const id = fromQuery ?? fromPath;
    if (id && YOUTUBE_ID.test(id)) {
      return { provider: "youtube", videoId: id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
    }
    return null;
  }
  if (hostIs(url, "youtu.be")) {
    const id = path.slice(1).split(/[/?#]/)[0];
    if (id && YOUTUBE_ID.test(id)) {
      return { provider: "youtube", videoId: id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
    }
    return null;
  }

  // Vimeo — vimeo.com/<id> or player.vimeo.com/video/<id>.
  if (hostIs(url, "vimeo.com")) {
    const id = (path.match(/^\/(?:video\/)?(\d+)/) ?? [])[1];
    if (id && NUMERIC_ID.test(id)) {
      return { provider: "vimeo", videoId: id, embedUrl: `https://player.vimeo.com/video/${id}` };
    }
    return null;
  }

  // Loom — loom.com/share/<id> or loom.com/embed/<id>.
  if (hostIs(url, "loom.com")) {
    const id = (path.match(/^\/(?:share|embed)\/([A-Za-z0-9]+)/) ?? [])[1];
    if (id && LOOM_ID.test(id)) {
      return { provider: "loom", videoId: id, embedUrl: `https://www.loom.com/embed/${id}` };
    }
    return null;
  }

  // Google Drive — drive.google.com/file/d/<id>/view or /open?id=<id>.
  if (hostIs(url, "drive.google.com")) {
    const fromPath = (path.match(/^\/file\/d\/([^/?#]+)/) ?? [])[1];
    const fromQuery = url.searchParams.get("id") ?? undefined;
    const id = fromPath ?? fromQuery;
    if (id && DRIVE_ID.test(id)) {
      return { provider: "google_drive", videoId: id, embedUrl: `https://drive.google.com/file/d/${id}/preview` };
    }
    return null;
  }

  return null;
}
