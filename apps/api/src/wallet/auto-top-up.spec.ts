import { TOP_UP_MAX_MINOR } from "@kudos/shared-types";
import {
  AUTO_TOP_UP_AMOUNT_MAX_MINOR,
  AUTO_TOP_UP_AMOUNT_MIN_MINOR,
  AUTO_TOP_UP_DEFAULT_AMOUNT_MINOR,
  AUTO_TOP_UP_DEFAULT_THRESHOLD_MINOR,
  AUTO_TOP_UP_PAUSE_REASONS,
  AUTO_TOP_UP_THRESHOLD_MAX_MINOR,
  AUTO_TOP_UP_THRESHOLD_MIN_MINOR,
  autoTopUpPauseCopy,
  pauseReasonOfStripeError,
} from "./auto-top-up";

/** A Stripe card error as the SDK shapes it on the wire. */
function cardError(code: string): unknown {
  return { type: "StripeCardError", code, message: "Your card was declined." };
}

describe("automatic top-up", () => {
  it("has usable copy for every pause reason", () => {
    for (const reason of AUTO_TOP_UP_PAUSE_REASONS) {
      const copy = autoTopUpPauseCopy(reason);
      expect(copy.why).toMatch(/\.$/);
      expect(copy.fix).toMatch(/\.$/);
    }
  });

  it("never lets an unattended charge exceed what the customer could authorise by hand", () => {
    expect(AUTO_TOP_UP_AMOUNT_MAX_MINOR).toBeLessThanOrEqual(TOP_UP_MAX_MINOR);
  });

  it("has defaults inside its own bounds", () => {
    expect(AUTO_TOP_UP_DEFAULT_THRESHOLD_MINOR).toBeGreaterThanOrEqual(
      AUTO_TOP_UP_THRESHOLD_MIN_MINOR,
    );
    expect(AUTO_TOP_UP_DEFAULT_THRESHOLD_MINOR).toBeLessThanOrEqual(
      AUTO_TOP_UP_THRESHOLD_MAX_MINOR,
    );
    expect(AUTO_TOP_UP_DEFAULT_AMOUNT_MINOR).toBeGreaterThanOrEqual(AUTO_TOP_UP_AMOUNT_MIN_MINOR);
    expect(AUTO_TOP_UP_DEFAULT_AMOUNT_MINOR).toBeLessThanOrEqual(AUTO_TOP_UP_AMOUNT_MAX_MINOR);
  });

  it("tops up by more than it waits for, so one top-up clears the threshold", () => {
    // A default that added less than the threshold would leave the account
    // below it and charge again the next morning, and the morning after that.
    expect(AUTO_TOP_UP_DEFAULT_AMOUNT_MINOR).toBeGreaterThan(AUTO_TOP_UP_DEFAULT_THRESHOLD_MINOR);
  });

  it("names the failure a customer can do something specific about", () => {
    expect(pauseReasonOfStripeError(cardError("authentication_required"))).toBe(
      "authentication_required",
    );
    expect(pauseReasonOfStripeError(cardError("card_declined"))).toBe("card_declined");
    expect(pauseReasonOfStripeError(cardError("expired_card"))).toBe("card_declined");
  });

  it("classifies anything that is not a card error as unknown, so it is escalated", () => {
    // Not a decline: the customer cannot fix an API outage by changing cards,
    // and telling them to would waste their time and hide ours.
    expect(pauseReasonOfStripeError({ type: "StripeAPIError", code: "api_error" })).toBe("unknown");
    expect(pauseReasonOfStripeError(new Error("connect ETIMEDOUT"))).toBe("unknown");
    expect(pauseReasonOfStripeError(null)).toBe("unknown");
    expect(pauseReasonOfStripeError("declined")).toBe("unknown");
  });

  it("treats a card error with no code as a decline rather than a mystery", () => {
    // Still the card. "Check the card" is useful; "something went wrong" is not.
    expect(pauseReasonOfStripeError({ type: "StripeCardError" })).toBe("card_declined");
  });
});
