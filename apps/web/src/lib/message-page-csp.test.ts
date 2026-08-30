import { messagePageCsp } from "./message-page-csp";

/**
 * The public message page renders author-written HTML to strangers. These
 * assertions pin the properties that make the policy worth having — verified
 * end to end in a real browser before it shipped (ADR 0181), but a unit test is
 * what stops the directive quietly loosening later.
 */
describe("messagePageCsp", () => {
  const directive = (csp: string, name: string) =>
    csp
      .split("; ")
      .find((part) => part.startsWith(`${name} `))
      ?.slice(name.length + 1) ?? "";

  it("carries the request's nonce on script-src", () => {
    expect(directive(messagePageCsp("abc123"), "script-src")).toContain("'nonce-abc123'");
  });

  it("never allows inline script — the whole point of the policy", () => {
    // 'unsafe-inline' here would re-enable exactly the injected <script> and
    // onerror= handler this exists to stop.
    expect(directive(messagePageCsp("n"), "script-src")).not.toContain("'unsafe-inline'");
    expect(directive(messagePageCsp("n"), "script-src")).not.toContain("'unsafe-eval'");
  });

  it("still allows inline style, which cannot execute", () => {
    // Tailwind and Next both emit style attributes; blocking them would break
    // the page without adding safety, and it is what lets script-src stay hard.
    expect(directive(messagePageCsp("n"), "style-src")).toContain("'unsafe-inline'");
  });

  it("allows only the video providers the message page can embed", () => {
    const frameSrc = directive(messagePageCsp("n"), "frame-src");
    expect(frameSrc).toContain("https://player.vimeo.com");
    expect(frameSrc).toContain("https://www.youtube.com");
    expect(frameSrc).not.toContain("*");
  });

  it("shuts the doors that have no business being open here", () => {
    const csp = messagePageCsp("n");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});
