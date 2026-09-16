/**
 * The spam gate on the public Enterprise form.
 *
 * `POST /enterprise-enquiries` is `@Public()` by design (ADR 0101) and the
 * 5/min per-IP throttle is a flood guard, not a spam guard — it was never going
 * to stop a dozen submissions from scattered IPs. Bot form-fillers were reaching
 * the ops inbox with random-string names, `<nonsense> LLC` organisations, a
 * harvested third-party email address and a message that was nothing but digits.
 *
 * Nothing here rejects anything. ADR 0101's promise is that a sales lead is
 * never lost, so a verdict changes exactly two things: the stored status, and
 * whether ops get an email. Which is why every rule below has to be one a human
 * would agree with on sight — a fuzzy score risks binning a real prospect, and
 * a lost Enterprise lead costs far more than a cluttered queue.
 *
 * See ADR 0244 and docs/enterprise-spam-and-email-injection-plan.md.
 */

/** The shape the gate needs — a subset of the create DTO, so it stays pure. */
export interface EnquirySpamInput {
  message: string;
  contactReference?: string;
  formOpenedAt?: string;
}

/**
 * Below this, a human did not read the page, pick a plan, and type an enquiry.
 * Generous on purpose: a fast typist pasting a prepared message is well clear of
 * it, and the cost of being wrong here is a lead sitting in the spam tab.
 */
export const MIN_FILL_SECONDS = 3;

/** The reasons, as stored in `spamReason`. Values are part of the ops UI. */
export type SpamReason = "honeypot" | "submitted-too-fast" | "message-has-no-words";

/**
 * Returns the rule that caught this submission, or null to let it through.
 * `now` is injected so the timing rule is testable without faking the clock.
 */
export function classifyEnquiry(input: EnquirySpamInput, now: Date): SpamReason | null {
  // A hidden field a person cannot see, let alone fill in.
  if (input.contactReference && input.contactReference.trim().length > 0) {
    return "honeypot";
  }

  if (input.formOpenedAt) {
    const openedAt = new Date(input.formOpenedAt);
    const elapsedMs = now.getTime() - openedAt.getTime();
    // A future or unparseable timestamp is not evidence of anything: clocks
    // drift, and a client can send whatever it likes. Only a real, implausibly
    // short gap counts, so a skewed clock never costs a genuine prospect.
    // An unparseable date gives NaN, and every comparison against NaN is false,
    // so `>= 0` covers that case too — no separate isFinite guard to go stale.
    if (elapsedMs >= 0 && elapsedMs < MIN_FILL_SECONDS * 1000) {
      return "submitted-too-fast";
    }
  }

  // The message that started this: `8838149310`. The field asks "what are you
  // looking for?" — a genuine answer always contains a letter. Deliberately
  // tests for *any* letter, in any script, rather than guessing at English.
  if (!/\p{L}/u.test(input.message)) {
    return "message-has-no-words";
  }

  return null;
}
