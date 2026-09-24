/**
 * Why a card did not go out, and what the customer is told about it.
 *
 * `autoSendOne` threw plain `Error`s and `runDue` recorded their `message`.
 * That is fine for a log line and wrong for anything a customer reads: a
 * message string is not a contract, and "Occasion has no approved design" is
 * not a sentence anybody outside this repo should ever see. So the throw now
 * carries a **code**, the code picks the copy, and the wording can be rewritten
 * without touching behaviour or breaking a test. See docs/adr/0254.
 */

export const AUTO_SEND_SKIP_REASONS = [
  "no_recipient",
  /** The contact was archived after this card was approved. Archiving is the
   *  only way to stop sending to somebody, so it has to stop this too. */
  "recipient_archived",
  "address_verification_required",
  "no_design",
  "missing_address",
  "plan_not_permitted",
  "insufficient_funds",
  "already_actioned",
  "unknown",
] as const;

export type AutoSendSkipReason = (typeof AUTO_SEND_SKIP_REASONS)[number];

/** A skip condition `autoSendOne` recognised, carrying the code the customer
 * copy is chosen by. Anything thrown that is *not* one of these classifies as
 * `unknown` — which is told to the customer too, and additionally raised with
 * Kudos HQ, because an unrecognised failure is the one we most need to see. */
export class AutoSendSkipError extends Error {
  constructor(
    readonly reason: AutoSendSkipReason,
    message: string,
  ) {
    super(message);
    this.name = "AutoSendSkipError";
  }
}

export interface AutoSendSkipCopy {
  /** Why it did not go, in the customer's language. One sentence. */
  why: string;
  /** The one thing they have to do about it. One sentence. */
  fix: string;
  /** Where in the app they do it. */
  href: string;
  /** Button label when this is the only card in the email. */
  cta: string;
}

/**
 * Whether the customer hears about this skip at all.
 *
 * Every reason but one is worth telling them: the whole premise of automatic
 * sending is that they are not watching, so a card that quietly did not go is
 * the worst outcome the product has. `already_actioned` is the exception and
 * it is not an exception to that rule — it means the occasion was no longer
 * approved-and-automatic when the run reached it, because a person checked it
 * out by hand or cancelled it themselves. Nothing failed, so there is nothing
 * to report.
 */
export function tellsCustomer(reason: AutoSendSkipReason): boolean {
  return reason !== "already_actioned";
}

/**
 * The copy for one skip. `recipientId` is threaded through because two of the
 * reasons are fixed on the contact's own page and the rest are not; a contact
 * we could not load falls back to the list.
 */
export function autoSendSkipCopy(
  reason: AutoSendSkipReason,
  recipientId: string | null,
): AutoSendSkipCopy {
  const contactHref = recipientId ? `/recipients/${recipientId}` : "/recipients";

  switch (reason) {
    case "no_recipient":
      return {
        why: "The contact this card was for is no longer on your list.",
        fix: "Cancel the card, or add the contact back and approve it again.",
        href: "/calendar",
        cta: "Open your calendar",
      };
    case "recipient_archived":
      return {
        why: "You archived this contact, so we did not send their card.",
        fix: "Nothing to do, unless archiving them was a mistake — restore them and approve the card again.",
        href: "/recipients",
        cta: "Open your contacts",
      };
    case "address_verification_required":
      // ADR 0039: the hold is correct behaviour and must stay. The failure here
      // was never the hold — it was that nobody was told about it.
      return {
        why: "An earlier card to them came back to us undelivered, so their automatic sends are on hold.",
        fix: "Confirm or correct their address and we will send it.",
        href: contactHref,
        cta: "Check the address",
      };
    case "no_design":
      return {
        why: "No card design is attached to it.",
        fix: "Choose a design and approve the card again.",
        href: "/approvals",
        cta: "Choose a design",
      };
    case "missing_address":
      return {
        why: "We do not hold a full postal address for them.",
        fix: "Add their address and we will send it on the next run.",
        href: contactHref,
        cta: "Add an address",
      };
    case "plan_not_permitted":
      return {
        why: "Automatic sending is not included on your current plan.",
        fix: "Upgrade your plan to start sending automatically again.",
        href: "/billing",
        cta: "See plans",
      };
    case "insufficient_funds":
      return {
        why: "Your wallet balance did not cover the card and its postage.",
        fix: "Top up your wallet and we will send it on the next run.",
        href: "/wallet",
        cta: "Top up",
      };
    // `already_actioned` never reaches here — tellsCustomer gates it — but the
    // switch is exhaustive so adding a reason without copy is a type error
    // rather than a card nobody is told about.
    case "already_actioned":
    case "unknown":
      return {
        why: "Something went wrong at our end.",
        fix: "We are looking into it. Get in touch if you would like an update.",
        href: "/support",
        cta: "Contact us",
      };
  }
}

/** Classify anything thrown out of a single auto-send. */
export function skipReasonOf(error: unknown): AutoSendSkipReason {
  return error instanceof AutoSendSkipError ? error.reason : "unknown";
}
