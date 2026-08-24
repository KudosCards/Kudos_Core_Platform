import { occasionDatesInstruction, type SendTimingMode } from "@kudos/shared-types";

/**
 * Which timing instruction a bulk send carries, given three signals that can
 * each speak to it. Getting the precedence wrong here doesn't throw — it posts
 * real cards on the wrong day, months from now, which is why it is pinned.
 */
describe("occasionDatesInstruction", () => {
  const base = {
    isEventSend: false,
    hasReconcileMatches: false,
    markHandled: true,
    preflightReady: true,
    timingMode: "now" as SendTimingMode | null,
  };

  it("leaves an event send alone — its reconcile list already dates it", () => {
    // The picker isn't shown for these, so any timing value is meaningless.
    expect(occasionDatesInstruction({ ...base, isEventSend: true })).toBeUndefined();
    expect(
      occasionDatesInstruction({ ...base, isEventSend: true, timingMode: "occasion" }),
    ).toBeUndefined();
  });

  it("declines occasion dating when the sender opted out of consuming matches", () => {
    // "Send this as well as their birthday card" — so the server must not find
    // the birthday by another route and consume it anyway.
    expect(
      occasionDatesInstruction({ ...base, hasReconcileMatches: true, markHandled: false }),
    ).toBe(false);
  });

  it("takes the opt-out over the timing choice, not the other way round", () => {
    // Both signals present and disagreeing. The explicit "don't consume these"
    // is the more specific instruction and has to win.
    expect(
      occasionDatesInstruction({
        ...base,
        hasReconcileMatches: true,
        markHandled: false,
        timingMode: "occasion",
      }),
    ).toBe(false);
  });

  it("says nothing until preflight has shown the sender the alternative", () => {
    // Taking "one date for everyone" literally before we've told them some
    // cards would otherwise be spread would quietly undo the server default.
    expect(occasionDatesInstruction({ ...base, preflightReady: false })).toBeUndefined();
    expect(occasionDatesInstruction({ ...base, timingMode: null })).toBeUndefined();
  });

  it("maps each timing choice to what the sender was shown", () => {
    expect(occasionDatesInstruction({ ...base, timingMode: "occasion" })).toBe(true);
    // Not undefined: the option reads "one date for everyone", and the server's
    // default would otherwise spread the send across the year.
    expect(occasionDatesInstruction({ ...base, timingMode: "now" })).toBe(false);
    // A scheduled send says nothing — deliverBy settles it, and sending both is
    // a 400.
    expect(occasionDatesInstruction({ ...base, timingMode: "scheduled" })).toBeUndefined();
  });
});
