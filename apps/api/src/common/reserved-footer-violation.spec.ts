import {
  BACK_RESERVED_FOOTER_MM,
  backReservedFooterTop,
  reservedFooterViolation,
} from "@kudos/shared-types";

/**
 * The rule that decides whether a design may be printed at all.
 *
 * This is the blocking half of the reserved footer (ADR 0166): a design whose
 * back reaches into the strip can no longer be saved, and can no longer be
 * ordered. Because it *blocks*, the property that matters most is the absence
 * of false positives — a check that wrongly refuses a good design costs a
 * customer their send, which is worse than the thing it prevents.
 */
describe("reservedFooterViolation", () => {
  const top = backReservedFooterTop("A6");
  const back = (elements: unknown[], background?: unknown) => ({
    pages: [
      { name: "front", elements: [] },
      { name: "back", background, elements },
    ],
  });

  it("passes a design with nothing on the back", () => {
    expect(reservedFooterViolation(back([]))).toBeNull();
  });

  it("passes an element that sits entirely above the strip", () => {
    expect(reservedFooterViolation(back([{ kind: "image", y: 10, height: 40 }]))).toBeNull();
  });

  it("passes an element that stops exactly at the line", () => {
    // The boundary is the whole point of a snap target; landing on it must be a
    // pass, or the editor's own snap would produce a design it then refuses.
    expect(reservedFooterViolation(back([{ kind: "image", y: top - 50, height: 50 }]))).toBeNull();
  });

  it("blocks an element that reaches into the strip", () => {
    const v = reservedFooterViolation(back([{ kind: "image", y: top - 10, height: 50 }]));
    expect(v).not.toBeNull();
    expect(v?.elements).toBe(1);
  });

  it("blocks an element placed wholly inside the strip", () => {
    const v = reservedFooterViolation(back([{ kind: "text", y: top + 20, fontSize: 16 }]));
    expect(v?.elements).toBe(1);
  });

  it("counts every offending element, and says so in the message", () => {
    const v = reservedFooterViolation(
      back([
        { kind: "image", y: top + 5, height: 20 },
        { kind: "image", y: top + 30, height: 20 },
        { kind: "image", y: 10, height: 20 },
      ]),
    );
    expect(v?.elements).toBe(2);
    expect(v?.message).toContain("2 items reach");
    expect(v?.message).toContain(`${BACK_RESERVED_FOOTER_MM}mm`);
  });

  it("uses singular wording for one element", () => {
    const v = reservedFooterViolation(back([{ kind: "image", y: top + 5, height: 20 }]));
    expect(v?.message).toContain("1 item reaches");
    expect(v?.message).toContain("move it above");
  });

  it("does NOT block on a background alone", () => {
    // A background always covers the strip and simply stops at the line — that
    // is the designed behaviour, not a fault. Blocking on it would block very
    // nearly every back design anyone has made.
    expect(reservedFooterViolation(back([], { type: "color", color: "#ff0000" }))).toBeNull();
    expect(reservedFooterViolation(back([], { type: "image", assetUrl: "https://x/y.png" }))).toBeNull();
  });

  it("still blocks an offending element when a background is also present", () => {
    const v = reservedFooterViolation(
      back([{ kind: "image", y: top + 5, height: 20 }], { type: "color", color: "#fff" }),
    );
    expect(v?.elements).toBe(1);
  });

  it("ignores the other three faces entirely", () => {
    // Only the back has a reserved strip. Content low on the front or an inside
    // face is fine, and refusing it would be exactly the false positive this
    // check must not produce.
    const doc = {
      pages: [
        { name: "front", elements: [{ kind: "image", y: top + 20, height: 40 }] },
        { name: "inside-left", elements: [{ kind: "image", y: top + 20, height: 40 }] },
        { name: "inside-right", elements: [{ kind: "image", y: top + 20, height: 40 }] },
        { name: "back", elements: [] },
      ],
    };
    expect(reservedFooterViolation(doc)).toBeNull();
  });

  it("passes a document with no back face at all", () => {
    expect(reservedFooterViolation({ pages: [{ name: "front", elements: [] }] })).toBeNull();
  });

  it("judges A6 by default, the strictest size we print", () => {
    // The reserved 30mm is 128.5 design units on A6 against 90.6 on A5, so the
    // band starts at y=505.5 on A6 but only y=543.4 on A5. An element ending
    // between the two blocks on A6 and not on A5 — and must block by default,
    // or switching the house print size would retroactively invalidate designs
    // that were already saved and sent.
    const a6OnlyElement = { kind: "image" as const, y: 495, height: 25 }; // bottom 520
    expect(reservedFooterViolation(back([a6OnlyElement]), "A5")).toBeNull();
    expect(reservedFooterViolation(back([a6OnlyElement]))).not.toBeNull();
    expect(reservedFooterViolation(back([a6OnlyElement]), "A6")).not.toBeNull();
  });

  it("does not mutate the document it is given", () => {
    const doc = back([{ kind: "image", y: top + 5, height: 20 }]);
    const snapshot = JSON.stringify(doc);
    reservedFooterViolation(doc);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });
});
