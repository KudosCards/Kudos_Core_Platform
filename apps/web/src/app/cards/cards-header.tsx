import { PublicHeader } from "@/components/public-header";

/** The public card-library header — the shared {@link PublicHeader} with the
 * catalog nav links. Kept as a thin alias so the pages already importing
 * `CardsHeader` pick up the basket + reminders without each being updated.
 *
 * FAQ sits here because this is where the questions it answers get asked — what
 * postage costs, how fast we post, what happens if a card comes back — and it
 * gives the FAQ an internal link from every catalog page rather than from the
 * homepage footer alone. */
export function CardsHeader() {
  return (
    <PublicHeader
      navLinks={[
        { href: "/cards", label: "Card library" },
        { href: "/faq", label: "FAQ" },
      ]}
    />
  );
}
