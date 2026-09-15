import type { DesignPage } from "@kudos/shared-types";

/**
 * What a person calls each face of a card.
 *
 * Written once. It had been written five times across the customer composer, the
 * pre-send check, the ops print sheet and two preview components, in two
 * different casings — and these strings are how a customer and an operator
 * describe the same fault to each other on a support call. "It's on the inside
 * right" has to mean the same thing on both screens.
 *
 * The API has no use for these: it prints faces, it does not label them.
 */
const FACE_LABEL: Record<DesignPage["name"], string> = {
  front: "Front",
  "inside-left": "Inside left",
  "inside-right": "Inside right",
  back: "Back",
};

/**
 * The label for a face, sentence-cased by default and lower-cased for the middle
 * of a sentence ("two pieces of text overlap on the inside right").
 *
 * Takes a loose string rather than the union, because some callers hold a face
 * name that came back from the server as plain JSON; an unrecognised one is
 * passed through rather than dropped, so a new face would read as itself instead
 * of vanishing from the sentence.
 */
export function faceLabel(face: string, options?: { lower?: boolean }): string {
  const label = FACE_LABEL[face as DesignPage["name"]] ?? face;
  return options?.lower ? label.toLowerCase() : label;
}
