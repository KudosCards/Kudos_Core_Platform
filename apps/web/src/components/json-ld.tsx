/**
 * Renders a JSON-LD block. Server-only — the payload is built during render and
 * inlined, so there's no runtime cost and crawlers see it in the first response.
 *
 * `<` is escaped so a value containing `</script>` can't break out of the tag.
 * Everything we pass in today is our own catalog data, but the escape means a
 * future field sourced from user input can't turn into an injection.
 *
 * See docs/seo-plan.md (Phase 3).
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
