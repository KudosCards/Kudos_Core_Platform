/**
 * Structured model for Kudos Cards' legal documents (Terms & Conditions and
 * Privacy Policy). Holding the content as data — rather than hand-marked-up JSX
 * — keeps a single source of truth that renders consistently everywhere and is
 * easy to update when the wording changes. See `legal-document.tsx` for the
 * renderer and `/terms`, `/privacy` for the pages.
 */

/** One block of content within a section (or the document intro). */
export type LegalBlock =
  | { kind: "p"; text: string }
  /** A sub-heading within a section (e.g. "When Kudos Cards is the controller"). */
  | { kind: "h3"; text: string }
  /** A bulleted list. */
  | { kind: "ul"; items: string[] };

/** A numbered top-level section. */
export interface LegalSection {
  /** Section number as shown in the source document (1, 2, 3 …). */
  n: number;
  heading: string;
  blocks: LegalBlock[];
}

/** A complete legal document. */
export interface LegalDoc {
  title: string;
  /** Human-readable "last updated" date, e.g. "13 August 2026". */
  updated: string;
  /** Paragraphs shown before the first numbered section. */
  intro: LegalBlock[];
  sections: LegalSection[];
}
