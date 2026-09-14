"use client";

import type { NamedByHand } from "@kudos/shared-types";
import Link from "next/link";

/** Face names as a sender reads them — the same words the print overlay uses. */
const FACE_LABEL: Record<string, string> = {
  front: "front",
  "inside-left": "inside left",
  "inside-right": "inside right",
  back: "back",
};

/** Whether this name is among the ones already confirmed, matched as the server
 * matches them: ignoring case and surrounding space. */
function isAcknowledged(acknowledgedNames: readonly string[], name: string): boolean {
  return acknowledgedNames.some((held) => held.trim().toLowerCase() === name.trim().toLowerCase());
}

/**
 * A person this design greets by hand, said where the sender can still act on
 * it — and, when the greeting is wrong for somebody in the run, the confirmation
 * the send will not go without.
 *
 * Shared by the bulk composer's pre-send check and the single-card send, because
 * the same design is reused across both and the two must not describe the same
 * finding differently. The server decides which findings need confirming
 * (`mustAcknowledge`) and refuses without it; this is the readable half.
 *
 * A confirmation rather than a refusal: "To Lizzie," on a card to Elizabeth is a
 * correct card, and a rule that traps it leaves the sender no way out. What it
 * stops is the hurried click-past, which is the failure that actually happened.
 * See docs/card-message-guardrails-plan.md.
 */
export function NamedByHandNotice({
  finding,
  total,
  editDesignHref,
  acknowledgedNames,
  onAcknowledgeName,
}: {
  finding: NamedByHand;
  /** Cards in this send, for "1 of 1" / "7 of 7". */
  total: number;
  editDesignHref: string;
  acknowledgedNames: readonly string[];
  onAcknowledgeName: (name: string, acknowledged: boolean) => void;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm text-foreground ${
        finding.mustAcknowledge
          ? "border-danger/30 bg-danger-soft"
          : "border-warning/30 bg-warning-soft"
      }`}
    >
      <span className="font-medium">
        This design says “{finding.name}” on the {FACE_LABEL[finding.face] ?? finding.face}
      </span>
      <span className="text-xs">
        {finding.wrongFor === 0
          ? "Everyone in this send has that name, so it may be fine."
          : `${finding.wrongFor} of ${total} ${
              total === 1 ? "card is" : "cards are"
            } going to somebody else, and will still say “${finding.name}”.`}{" "}
        <Link href={editDesignHref} className="font-medium underline">
          Open the design
        </Link>{" "}
        and use the First name field so each card is addressed to its own recipient.
      </span>
      {finding.mustAcknowledge && (
        <label className="mt-1 flex items-start gap-2 text-xs font-medium">
          <input
            type="checkbox"
            className="mt-0.5 size-3.5 shrink-0 accent-danger"
            checked={isAcknowledged(acknowledgedNames, finding.name)}
            onChange={(event) => onAcknowledgeName(finding.name, event.target.checked)}
          />
          <span>
            Send {total === 1 ? "this card" : "these cards"} as {total === 1 ? "it is" : "they are"}{" "}
            — I know {finding.wrongFor === 1 && total === 1 ? "it" : `${finding.wrongFor} of them`}{" "}
            will say “{finding.name}” to somebody else.
          </span>
        </label>
      )}
    </div>
  );
}
