import {
  OCCASION_STATUS_LABELS,
  OCCASION_STATUS_STYLES,
  occasionKind,
  occasionName,
} from "./occasions";
import { occasionStatusSchema } from "@kudos/shared-types";

/**
 * The words shown for one occasion. Two screens used to disagree about them —
 * the calendar called a queued card "Card ordered" and the contact page called
 * the same card "In fulfilment" — and neither screen ever showed a hand-named
 * event's name *and* its kind, so a leaver's date named "96" read as either a
 * bare "96" or a bare "Leaver" depending which page you were on.
 */

describe("occasionName and occasionKind", () => {
  it("shows the name the customer gave, with its kind alongside", () => {
    const event = { type: "leaver", title: "96" };
    expect(occasionName(event)).toBe("96");
    expect(occasionKind(event)).toBe("Leaver");
  });

  it("falls back to the kind when there is no name", () => {
    expect(occasionName({ type: "birthday", title: null })).toBe("Birthday");
    expect(occasionName({ type: "staff_recognition" })).toBe("Staff recognition");
  });

  it("does not repeat itself when the name is the kind", () => {
    // "Birthday · Birthday" reads as a stutter.
    expect(occasionKind({ type: "birthday", title: null })).toBeNull();
    expect(occasionKind({ type: "birthday", title: "Birthday" })).toBeNull();
  });

  it("treats a whitespace-only title as no title", () => {
    expect(occasionName({ type: "achievement", title: "   " })).toBe("Achievement");
  });

  it("keeps an unknown type readable rather than blank", () => {
    expect(occasionName({ type: "some_new_type" })).toBe("some_new_type");
  });
});

describe("status vocabulary", () => {
  it("names and styles every status the API can return", () => {
    // One table, covering the whole enum. A status present in one table and not
    // the other renders either unnamed or unstyled, and nothing would say so.
    for (const status of occasionStatusSchema.options) {
      expect(OCCASION_STATUS_LABELS[status]).toBeTruthy();
      expect(OCCASION_STATUS_STYLES[status]).toBeTruthy();
    }
  });

  it("never tells a customer they skipped something they did not choose", () => {
    expect(OCCASION_STATUS_LABELS.missed).toBe("Missed");
    expect(OCCASION_STATUS_LABELS.skipped).toBe("Skipped");
    expect(OCCASION_STATUS_LABELS.missed).not.toBe(OCCASION_STATUS_LABELS.skipped);
  });
});
