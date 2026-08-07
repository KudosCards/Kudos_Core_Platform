import { sanitizeMessageHtml } from "./sanitize-message-html";

/** Unit tests for the Message Pages HTML sanitiser (ADR 0132 §5). The message
 * renders on a public, unauthenticated page, so the allowlist is deliberately
 * tight and every attribute is stripped. */
describe("sanitizeMessageHtml", () => {
  it("keeps the allowlisted inline + list tags", () => {
    const input =
      "<p>Happy <b>birthday</b> <i>Sam</i> <u>today</u></p><ul><li>one</li><li>two</li></ul>";
    expect(sanitizeMessageHtml(input)).toBe(input);
  });

  it("keeps the semantic synonyms strong/em", () => {
    expect(sanitizeMessageHtml("<strong>bold</strong> <em>italic</em>")).toBe(
      "<strong>bold</strong> <em>italic</em>",
    );
  });

  it("drops a <script> tag and its contents entirely", () => {
    expect(sanitizeMessageHtml("Hi<script>alert('xss')</script> there")).toBe("Hi there");
  });

  it("strips disallowed tags but keeps their text", () => {
    expect(sanitizeMessageHtml("<div>kept text</div>")).toBe("kept text");
    // Links belong to the CTA, not the body — the <a> is unwrapped.
    expect(sanitizeMessageHtml('<a href="https://evil.test">click</a>')).toBe("click");
  });

  it("removes every attribute, including event handlers and inline styles", () => {
    expect(sanitizeMessageHtml('<p onclick="steal()" style="color:red">hi</p>')).toBe("<p>hi</p>");
  });

  it("neutralises an <img onerror> payload", () => {
    expect(sanitizeMessageHtml('<img src=x onerror="alert(1)">')).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeMessageHtml("   <p>hi</p>   ")).toBe("<p>hi</p>");
  });
});
