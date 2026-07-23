import type { DesignDocument } from "./card";

/**
 * A card's text elements may contain merge tokens (e.g. "Dear {name},") that are
 * replaced per recipient when the card is rendered/printed — so one design sent
 * to a whole list produces a personalised card for each person. This is the
 * single source of truth for that substitution, shared by the web (send-flow
 * previews, ops production render) and the API. See
 * docs/adr/0031-name-merge-tokens.md.
 */
export interface MergeRecipient {
  firstName: string;
  lastName: string;
}

/** The tokens we substitute, shown to designers in the editor. Case-insensitive. */
export const MERGE_TOKENS = ["{name}", "{firstName}", "{lastName}", "{fullName}"] as const;

/** Resolve a single token's inner name (already lower-cased) to its value, or
 * null if it isn't one we recognise (so unknown braces are left untouched). */
function tokenValue(inner: string, recipient: MergeRecipient): string | null {
  switch (inner.toLowerCase()) {
    case "name":
    case "firstname":
      return recipient.firstName;
    case "lastname":
      return recipient.lastName;
    case "fullname":
      return `${recipient.firstName} ${recipient.lastName}`.trim();
    default:
      return null;
  }
}

/** Substitute merge tokens in a single string. Unknown `{tokens}` are preserved. */
export function applyMergeText(text: string, recipient: MergeRecipient): string {
  return text.replace(/\{([a-zA-Z]+)\}/g, (whole, inner: string) => {
    const value = tokenValue(inner, recipient);
    return value === null ? whole : value;
  });
}

/** Whether a design contains any recognised merge token (so the UI can flag that
 * a card will be personalised per recipient). */
export function hasMergeTokens(document: DesignDocument): boolean {
  return document.pages.some((page) =>
    page.elements.some(
      (element) =>
        element.kind === "text" && applyMergeText(element.text, { firstName: "\0", lastName: "\0" }) !== element.text,
    ),
  );
}

/** Return a copy of the design with every text element's merge tokens resolved
 * for `recipient`. Non-text elements are untouched. Pure — never mutates. */
export function applyMergeTokens(document: DesignDocument, recipient: MergeRecipient): DesignDocument {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      elements: page.elements.map((element) =>
        element.kind === "text"
          ? { ...element, text: applyMergeText(element.text, recipient) }
          : element,
      ),
    })),
  };
}
