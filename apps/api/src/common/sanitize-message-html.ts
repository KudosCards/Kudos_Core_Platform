import sanitizeHtml from "sanitize-html";

/**
 * Message Pages render an author's written message as HTML on a public,
 * unauthenticated page — so every byte is sanitised on the way in against a
 * deliberately tight allowlist (ADR 0132 §5). Only basic inline emphasis and
 * lists survive; there are no allowed attributes, so no `style`, no `href`, no
 * event handlers — closing stored-XSS at the door rather than trusting the
 * renderer. Links belong to the dedicated, https-validated CTA, not the body.
 *
 * `sanitize-html` drops disallowed tags while keeping their text, and strips
 * `<script>`/`<style>` content entirely, so a hostile paste degrades to plain
 * text rather than executing.
 */
const ALLOWED_TAGS = ["b", "strong", "i", "em", "u", "p", "br", "ul", "ol", "li"];

export function sanitizeMessageHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {},
    // Belt-and-braces: even if a tag were added above, never emit these.
    disallowedTagsMode: "discard",
  }).trim();
}
