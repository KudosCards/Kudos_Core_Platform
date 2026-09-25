import { meaningOfBrevoEvent, normaliseBrevoEvent } from "./brevo-event";

describe("normaliseBrevoEvent", () => {
  it("reduces every spelling of an event to the same key", () => {
    const keys = ["hard_bounce", "hardBounce", "HARD-BOUNCE", "Hard Bounce"].map(
      normaliseBrevoEvent,
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("hardbounce");
  });
});

describe("meaningOfBrevoEvent", () => {
  // Brevo's subscription API takes camelCase while the delivered payload uses
  // snake_case, so both have to land on a suppression or we record nothing.
  it.each([
    ["hard_bounce", "hard_bounce"],
    ["hardBounce", "hard_bounce"],
    ["blocked", "blocked"],
    ["invalid_email", "invalid"],
    ["invalid", "invalid"],
    ["spam", "spam"],
    ["complaint", "spam"],
    ["unsubscribed", "unsubscribed"],
  ])("treats %s as a suppression (%s)", (event, reason) => {
    expect(meaningOfBrevoEvent(event)).toEqual({ kind: "suppress", reason });
  });

  it("treats a delivery as proof the address works again", () => {
    expect(meaningOfBrevoEvent("delivered")).toEqual({ kind: "recover" });
  });

  // A full mailbox is not a dead address. Suppressing on one would lose mail we
  // could have delivered on the next attempt.
  it.each(["soft_bounce", "softBounce", "deferred", "opened", "click", "request"])(
    "ignores %s",
    (event) => {
      expect(meaningOfBrevoEvent(event)).toEqual({ kind: "ignore" });
    },
  );

  it("ignores an event it has never heard of rather than guessing", () => {
    expect(meaningOfBrevoEvent("some_future_event")).toEqual({ kind: "ignore" });
  });
});
