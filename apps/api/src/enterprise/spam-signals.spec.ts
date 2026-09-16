import { MIN_FILL_SECONDS, classifyEnquiry } from "./spam-signals";

/**
 * The spam gate on the public Enterprise form. Each rule is tested from both
 * sides, because the expensive failure here is not letting a bot through — it
 * is binning a real Enterprise prospect. See ADR 0244.
 */
describe("classifyEnquiry", () => {
  const now = new Date("2026-09-16T10:00:00.000Z");
  const genuine = {
    message: "We run three tutoring centres and want cards handled centrally.",
  };

  it("lets a genuine enquiry through", () => {
    expect(classifyEnquiry(genuine, now)).toBeNull();
  });

  describe("the honeypot", () => {
    it("catches a filled hidden field", () => {
      expect(classifyEnquiry({ ...genuine, contactReference: "wpZXqYlycGeEyTXT" }, now)).toBe(
        "honeypot",
      );
    });

    it("ignores an empty one — a real browser submits it blank", () => {
      expect(classifyEnquiry({ ...genuine, contactReference: "" }, now)).toBeNull();
    });

    it("ignores whitespace, which is not a bot filling a field in", () => {
      expect(classifyEnquiry({ ...genuine, contactReference: "   " }, now)).toBeNull();
    });
  });

  describe("the timing check", () => {
    const openedAt = (secondsAgo: number) =>
      new Date(now.getTime() - secondsAgo * 1000).toISOString();

    it("catches a form submitted faster than a person could fill it", () => {
      expect(classifyEnquiry({ ...genuine, formOpenedAt: openedAt(1) }, now)).toBe(
        "submitted-too-fast",
      );
    });

    it("lets a plausible fill through", () => {
      expect(classifyEnquiry({ ...genuine, formOpenedAt: openedAt(45) }, now)).toBeNull();
    });

    it("lets the boundary itself through, so the threshold is inclusive", () => {
      expect(
        classifyEnquiry({ ...genuine, formOpenedAt: openedAt(MIN_FILL_SECONDS) }, now),
      ).toBeNull();
    });

    it("treats a missing timestamp as neutral, not as evidence", () => {
      // Anything that isn't our web form won't send one.
      expect(classifyEnquiry(genuine, now)).toBeNull();
    });

    it("treats a future timestamp as neutral — a skewed clock is not a bot", () => {
      expect(classifyEnquiry({ ...genuine, formOpenedAt: openedAt(-600) }, now)).toBeNull();
    });

    it("treats an unparseable timestamp as neutral", () => {
      expect(classifyEnquiry({ ...genuine, formOpenedAt: "not-a-date" }, now)).toBeNull();
    });
  });

  describe("the message check", () => {
    it("catches a message with no letters in it at all", () => {
      // The submission that started this: the message field was `8838149310`.
      expect(classifyEnquiry({ message: "8838149310" }, now)).toBe("message-has-no-words");
    });

    it("lets a short but real message through", () => {
      expect(classifyEnquiry({ message: "Call me" }, now)).toBeNull();
    });

    it("lets a non-English message through — it looks for any letter, not English", () => {
      expect(classifyEnquiry({ message: "Καλημέρα, 800 μαθητές" }, now)).toBeNull();
    });

    it("lets a message that is mostly numbers through, if it has words", () => {
      expect(classifyEnquiry({ message: "800 contacts, 3 sites, 07654 328604" }, now)).toBeNull();
    });
  });

  it("reports the honeypot first when a submission trips several rules", () => {
    // The order matters only for what ops read in the spam tab; the honeypot is
    // the least ambiguous signal, so it is the one worth showing.
    expect(
      classifyEnquiry(
        { message: "8838149310", contactReference: "x", formOpenedAt: now.toISOString() },
        now,
      ),
    ).toBe("honeypot");
  });
});
