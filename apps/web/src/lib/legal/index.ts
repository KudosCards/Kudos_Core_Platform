export type { LegalDoc, LegalSection, LegalBlock } from "./types";
export { TERMS } from "./terms";
export { PRIVACY } from "./privacy";

/** The canonical routes for the legal pages, so links stay consistent. */
export const LEGAL_LINKS = {
  terms: { href: "/terms", label: "Terms & Conditions" },
  privacy: { href: "/privacy", label: "Privacy Policy" },
} as const;
