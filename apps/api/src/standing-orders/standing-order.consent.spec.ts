import {
  STANDING_ORDER_CONSENT_STATEMENT,
  STANDING_ORDER_CONSENT_VERSION,
  consentIsCurrent,
} from "./standing-order.consent";

describe("standing order consent", () => {
  it("says what we will do, in sentences", () => {
    expect(STANDING_ORDER_CONSENT_STATEMENT.length).toBeGreaterThan(0);
    for (const line of STANDING_ORDER_CONSENT_STATEMENT) {
      expect(line.trim()).toBe(line);
      expect(line).toMatch(/\.$/);
    }
  });

  it("tells them the three things a standing order actually does", () => {
    // Not a style check. These are the facts somebody is agreeing to, and a
    // statement that stopped mentioning one of them would be consent to
    // something other than what the product does.
    const statement = STANDING_ORDER_CONSENT_STATEMENT.join(" ").toLowerCase();
    // We send without asking each time.
    expect(statement).toContain("without checking with you");
    // It costs money, from the wallet.
    expect(statement).toContain("wallet");
    // They can stop it.
    expect(statement).toContain("switch this off");
  });

  it("treats only the current version as consent", () => {
    expect(consentIsCurrent(STANDING_ORDER_CONSENT_VERSION)).toBe(true);
  });

  it("treats never-agreed and agreed-to-older as not consented", () => {
    // Both mean the same thing operationally — nobody has agreed to what the
    // product does today — and both must stop it running.
    expect(consentIsCurrent(null)).toBe(false);
    expect(consentIsCurrent(STANDING_ORDER_CONSENT_VERSION - 1)).toBe(false);
  });

  it("does not accept a version from the future either", () => {
    // A row written by a newer deploy, read by an older one. Refusing is the
    // safe direction: it stops sending rather than sending on a promise this
    // code does not know it made.
    expect(consentIsCurrent(STANDING_ORDER_CONSENT_VERSION + 1)).toBe(false);
  });
});
