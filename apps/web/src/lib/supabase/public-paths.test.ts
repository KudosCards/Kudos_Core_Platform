import { isPublicPath } from "./public-paths";

/**
 * The paths somebody reaches while logged out.
 *
 * Every one of these is the landing page of a link we emailed. If the proxy
 * does not know a path is public it redirects to /login before the page runs —
 * which spends nothing, shows nothing and explains nothing, so it reaches
 * support as "the email doesn't work" rather than as a redirect.
 *
 * `/auth/confirm` was missing from this list from the day the page was written.
 * See ADR 0267.
 */
describe("paths reachable without a session", () => {
  it.each([
    ["/auth/confirm", "a signup confirmation link"],
    ["/reset-password", "a password-reset link"],
    ["/forgot-password", "the form that asks for a reset link"],
    ["/admin-set-password", "an operator invite"],
    ["/invite/abc123", "a team invite"],
    ["/rts/abc123", "a returned-to-sender address recovery link"],
    ["/login", "the login page itself"],
    ["/register", "the signup page"],
  ])("%s — %s", (pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  it.each([["/dashboard"], ["/click-and-forget"], ["/wallet"], ["/recipients"]])(
    "still guards %s",
    (pathname) => {
      expect(isPublicPath(pathname)).toBe(false);
    },
  );

  it("does not make the whole /auth tree public", () => {
    // Only the one landing page. A future /auth/anything-else has to make its
    // own case rather than inheriting this.
    expect(isPublicPath("/auth/something-else")).toBe(false);
  });
});
