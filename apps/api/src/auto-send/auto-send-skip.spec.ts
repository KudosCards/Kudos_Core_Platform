import {
  AUTO_SEND_SKIP_REASONS,
  AutoSendSkipError,
  autoSendSkipCopy,
  skipReasonOf,
  tellsCustomer,
} from "./auto-send-skip";

describe("auto-send skip reasons", () => {
  it("has usable copy for every reason", () => {
    for (const reason of AUTO_SEND_SKIP_REASONS) {
      const copy = autoSendSkipCopy(reason, "recipient-1");
      expect(copy.why.length).toBeGreaterThan(0);
      expect(copy.fix.length).toBeGreaterThan(0);
      expect(copy.cta.length).toBeGreaterThan(0);
      // An app-relative path, so the email can prefix WEB_APP_URL and the inbox
      // can use it as-is. An absolute URL in either place is a broken link.
      expect(copy.href).toMatch(/^\/[a-z]/);
    }
  });

  it("says why and what to do in separate sentences", () => {
    // The inbox body is `${why} ${fix}` — two sentences, so both have to end.
    for (const reason of AUTO_SEND_SKIP_REASONS) {
      const copy = autoSendSkipCopy(reason, null);
      expect(copy.why).toMatch(/\.$/);
      expect(copy.fix).toMatch(/\.$/);
    }
  });

  it("points the contact-fixable reasons at that contact", () => {
    expect(autoSendSkipCopy("missing_address", "abc").href).toBe("/recipients/abc");
    expect(autoSendSkipCopy("address_verification_required", "abc").href).toBe("/recipients/abc");
  });

  it("falls back to the contact list when there is no contact to open", () => {
    // `no_recipient` is exactly this case, and a link to /recipients/null is
    // worse than a link to the list.
    expect(autoSendSkipCopy("missing_address", null).href).toBe("/recipients");
    expect(autoSendSkipCopy("address_verification_required", null).href).toBe("/recipients");
  });

  it("tells the customer about every failure, and only stays quiet when nothing failed", () => {
    const quiet = AUTO_SEND_SKIP_REASONS.filter((reason) => !tellsCustomer(reason));
    expect(quiet).toEqual(["already_actioned"]);
  });

  it("classifies a recognised skip by its code", () => {
    expect(
      skipReasonOf(new AutoSendSkipError("no_design", "Occasion has no approved design")),
    ).toBe("no_design");
  });

  it("classifies anything else as unknown, so it is escalated rather than explained away", () => {
    expect(skipReasonOf(new Error("connect ETIMEDOUT"))).toBe("unknown");
    expect(skipReasonOf("not even an error")).toBe("unknown");
    expect(skipReasonOf(undefined)).toBe("unknown");
  });
});
