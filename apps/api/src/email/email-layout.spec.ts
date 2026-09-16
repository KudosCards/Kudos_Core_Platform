import { emailButton, escapeHtml, escapeUrlAttribute, renderBrandedEmail } from "./email-layout";

/**
 * The branded email shell escapes every plain-text field it owns.
 *
 * This exists because of a real gap: `preheader` and `heading` were
 * interpolated raw, and while all fourteen callers escaped what they put in
 * `bodyHtml`, not one escaped the preheader. Five of them pass user-supplied
 * values — the worst being an anonymous `senderName` on the public message-page
 * reply route, in an email sent to a paying customer. A hostile name closed the
 * hidden preheader `<div>` and rendered a live link in the body.
 *
 * So these are not tests of `escapeHtml`; they are tests that the *layout*
 * escapes, so a caller cannot reintroduce the hole by forgetting.
 * See docs/enterprise-spam-and-email-injection-plan.md.
 */
describe("renderBrandedEmail", () => {
  const base = {
    webAppUrl: "https://app.kudoscards.co.uk",
    preheader: "A plain preheader",
    heading: "A plain heading",
    bodyHtml: "<p>composed by the caller</p>",
  };

  /** The payload from the recon, which escaped the hidden div in the old shell. */
  const BREAKOUT =
    '</div><p style="font-size:16px"><a href="https://evil.example/pay">Your invoice is overdue</a></p><div style="display:none">';

  it("neutralises a preheader that tries to break out of the hidden div", () => {
    const html = renderBrandedEmail({ ...base, preheader: `Anna${BREAKOUT} replied` });

    // The giveaway the old shell produced: a live anchor sitting outside the
    // hidden preheader div, visible in the body of the email.
    expect(html).not.toMatch(/<\/div>\s*<p[^>]*><a href="https:\/\/evil/);
    expect(html).not.toContain('<a href="https://evil.example/pay">');
    expect(html).toContain("&lt;/div&gt;");
  });

  it("escapes a heading, which lands in both the title and the H1", () => {
    const html = renderBrandedEmail({ ...base, heading: '<script>x</script> & "co"' });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; &quot;co&quot;");
    // Both sinks, not just the visible one.
    expect(html).toContain("<title>&lt;script&gt;");
  });

  it("escapes the footer note", () => {
    const html = renderBrandedEmail({ ...base, footerNote: "<b>opt out</b>" });

    expect(html).not.toContain("<b>opt out</b>");
    expect(html).toContain("&lt;b&gt;opt out&lt;/b&gt;");
  });

  it("omits the footer note entirely when there isn't one", () => {
    const html = renderBrandedEmail(base);

    expect(html).toContain("Automated cards that mean something");
    expect(html).not.toContain("undefined");
  });

  it("flattens control characters in a single-line field", () => {
    const html = renderBrandedEmail({ ...base, heading: "Line one\r\nLine two" });

    expect(html).toContain("Line one Line two");
    expect(html).not.toContain("Line one\r\n");
  });

  it("leaves bodyHtml alone — it is the caller's composed markup", () => {
    const html = renderBrandedEmail({
      ...base,
      bodyHtml: '<p style="margin:0">Hello <strong>Dana</strong></p>',
    });

    expect(html).toContain('<p style="margin:0">Hello <strong>Dana</strong></p>');
  });

  describe("the CTA", () => {
    it("escapes a label", () => {
      const html = renderBrandedEmail({
        ...base,
        cta: { url: "https://app.kudoscards.co.uk/orders", label: "<img src=x> & go" },
      });

      expect(html).not.toContain("<img src=x>");
      expect(html).toContain("&lt;img src=x&gt; &amp; go");
    });

    it("stops a URL breaking out of the href attribute", () => {
      const html = renderBrandedEmail({
        ...base,
        cta: { url: '"><script>alert(1)</script>', label: "Go" },
      });

      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&quot;&gt;&lt;script&gt;");
    });

    it("stops a URL breaking out of the paste-this-link fallback too", () => {
      // The fallback renders the URL a second time, in its own href and as
      // visible text. It is escaped separately from the button, so it needs its
      // own guard — the button's escaping does not cover it.
      const html = renderBrandedEmail({
        ...base,
        cta: { url: '"><script>alert(1)</script>', label: "Go" },
        showLinkFallback: true,
      });

      expect(html).toContain("Button not working?");
      expect(html).not.toContain("<script>alert(1)</script>");
    });

    it("keeps a query string intact, ampersands and all", () => {
      // Password-reset and magic links live here; mangling one locks a customer
      // out, so `&` is deliberately left as-is (it is not an escape vector).
      const url = "https://app.kudoscards.co.uk/reset?token=abc123&type=recovery&redirect=/billing";
      const html = renderBrandedEmail({
        ...base,
        cta: { url, label: "Choose a new password" },
        showLinkFallback: true,
      });

      expect(html).toContain(`<a href="${url}"`);
      // And in the paste-this-link fallback, which must be copyable verbatim.
      expect(html.match(new RegExp(url.replace(/[?/]/g, "\\$&"), "g"))?.length).toBeGreaterThan(1);
    });
  });
});

describe("escapeUrlAttribute", () => {
  it("removes the characters that break an attribute or open a tag", () => {
    expect(escapeUrlAttribute(`"'<>`)).toBe("&quot;&#39;&lt;&gt;");
  });

  it("leaves an ampersand alone", () => {
    expect(escapeUrlAttribute("https://x.test/a?b=1&c=2")).toBe("https://x.test/a?b=1&c=2");
  });

  it("flattens a newline, so a URL can't spill into surrounding markup", () => {
    expect(escapeUrlAttribute("https://x.test\r\n\tonload=alert(1)")).toBe(
      "https://x.test onload=alert(1)",
    );
  });
});

describe("escapeHtml", () => {
  it("escapes the four characters that matter in HTML text and attributes", () => {
    expect(escapeHtml(`& < > "`)).toBe("&amp; &lt; &gt; &quot;");
  });

  it("escapes the ampersand first, so an escape isn't double-escaped", () => {
    expect(escapeHtml("<a>")).toBe("&lt;a&gt;");
  });
});

describe("emailButton", () => {
  it("escapes both its arguments, wherever it is called from", () => {
    const html = emailButton('https://x.test/"><b>', "<i>Go</i>");

    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>Go</i>");
    expect(html).toContain("&lt;i&gt;Go&lt;/i&gt;");
  });
});
