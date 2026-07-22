import { PublicHeader } from "@/components/public-header";

/** The public card-library header — the shared {@link PublicHeader} with a
 * "Card library" nav link. Kept as a thin alias so the pages already importing
 * `CardsHeader` pick up the basket + reminders without each being updated. */
export function CardsHeader() {
  return <PublicHeader navLinks={[{ href: "/cards", label: "Card library" }]} />;
}
