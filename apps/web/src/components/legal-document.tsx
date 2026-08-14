import type { LegalBlock, LegalDoc } from "@/lib/legal";

/** Render one content block (paragraph, sub-heading or bullet list). */
function Block({ block }: { block: LegalBlock }) {
  if (block.kind === "h3") {
    return <h3 className="mt-6 text-base font-semibold text-slate-900">{block.text}</h3>;
  }
  if (block.kind === "ul") {
    return (
      <ul className="my-3 list-disc space-y-1.5 pl-6 text-slate-600">
        {block.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }
  return <p className="my-3 text-slate-600">{block.text}</p>;
}

/**
 * Renders a structured {@link LegalDoc} (Terms or Privacy) as a readable,
 * responsive article. Pure/presentational — the content lives in `lib/legal`.
 */
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-10 sm:py-14">
      <header className="border-b border-slate-100 pb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">Kudos Cards</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900 sm:text-4xl">{doc.title}</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: {doc.updated}</p>
      </header>

      <div className="mt-6 text-[15px] leading-relaxed">
        {doc.intro.map((block, i) => (
          <Block key={`intro-${i}`} block={block} />
        ))}

        {doc.sections.map((section) => (
          <section key={section.n} className="mt-8 scroll-mt-24" id={`section-${section.n}`}>
            <h2 className="text-xl font-semibold text-slate-900">
              {section.n}. {section.heading}
            </h2>
            {section.blocks.map((block, i) => (
              <Block key={`${section.n}-${i}`} block={block} />
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
