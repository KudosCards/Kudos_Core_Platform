"use client";

import type { DesignDocument, DesignPage, TextElement } from "@kudos/shared-types";
import { stackedTextOnPage } from "@kudos/shared-types";

/**
 * What one face of a card actually says, in words.
 *
 * A super admin looked at a card in the order cockpit, saw two messages
 * overlapping, and had no way to find out what it carried beyond reading the
 * render — which is precisely the thing that had gone wrong. The print overlay
 * already holds each card's own `documentSnapshot` (it is what it draws), so
 * this needs nothing new from the server: it only stops throwing away the one
 * representation a person can actually read.
 *
 * The text shown is the **merged** text, `{firstName}` already resolved, because
 * that is what will be printed on this particular card. Seeing "To Florence"
 * beside "To Elise" is the whole point.
 *
 * Screen-only. It is a diagnostic, never part of the printed sheet.
 */
export function CardTextReadout({
  document,
  face,
}: {
  document: DesignDocument;
  face: DesignPage["name"];
}) {
  const page = document.pages.find((candidate) => candidate.name === face);
  if (!page) return null;

  const texts = page.elements.filter(
    (element): element is TextElement => element.kind === "text" && element.text.trim() !== "",
  );
  if (texts.length === 0) return null;

  // The same rule the editor and the pre-send check use, so an operator is not
  // shown a third opinion about what counts as overlapping.
  const stacked = stackedTextOnPage(page);
  const stackedIds = new Set(stacked.flatMap((pair) => pair.ids));

  return (
    <details
      // Open when there is something to see. Closed the rest of the time: an
      // operator working through a print run does not want every card's text
      // unfolded at them, and a panel that is always open is one nobody reads.
      open={stacked.length > 0}
      className="w-full max-w-md rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 print:hidden"
    >
      <summary className="cursor-pointer text-xs text-black/60">
        What this card says — {texts.length} text block{texts.length === 1 ? "" : "s"}
        {stacked.length > 0 && (
          <span className="ml-1 font-medium text-amber-800">
            ({stacked.length} overlapping{stacked.length === 1 ? " pair" : " pairs"})
          </span>
        )}
      </summary>
      <ol className="mt-2 flex flex-col gap-2">
        {texts.map((element) => {
          const overlapping = stackedIds.has(element.id);
          return (
            <li
              key={element.id}
              className={`rounded-md border px-2 py-1.5 ${
                overlapping ? "border-amber-300 bg-amber-50" : "border-black/10 bg-white"
              }`}
            >
              {overlapping && (
                <span className="mb-1 block text-[11px] font-medium text-amber-800">
                  Overlaps another block on this face
                </span>
              )}
              {/* Pre-wrapped: the line breaks are the ones on the card, and a
                  message reflowed to the panel's width is a different message to
                  read. */}
              <p className="whitespace-pre-wrap text-xs text-black">{element.text}</p>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
