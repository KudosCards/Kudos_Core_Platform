import {
  REDACTED,
  UPSTREAM_DETAIL_LIMIT,
  formatUpstreamDetail,
  upstreamDetail,
  withUpstreamDetail,
} from "./upstream-detail";

describe("formatUpstreamDetail", () => {
  it("prefers the API's own message field over the envelope around it", () => {
    expect(formatUpstreamDetail('{"message":"This app is not authorised"}')).toBe(
      "This app is not authorised",
    );
    expect(formatUpstreamDetail('{"error_description":"code expired"}')).toBe("code expired");
    expect(formatUpstreamDetail('{"error":"invalid_grant"}')).toBe("invalid_grant");
    expect(formatUpstreamDetail('{"detail":"not found"}')).toBe("not found");
  });

  it("reaches one level into a nested error object", () => {
    expect(formatUpstreamDetail('{"error":{"message":"scope missing"}}')).toBe("scope missing");
  });

  it("takes the first field that actually has something in it", () => {
    expect(formatUpstreamDetail('{"message":"","error":"the real one"}')).toBe("the real one");
    expect(formatUpstreamDetail('{"message":"   ","detail":"the real one"}')).toBe("the real one");
  });

  it("keeps plain text as it is", () => {
    expect(formatUpstreamDetail("Service Unavailable")).toBe("Service Unavailable");
  });

  it("keeps the raw JSON when there is no recognisable message field", () => {
    // Better an unfamiliar shape than nothing: a human can still read it.
    expect(formatUpstreamDetail('{"code":42}')).toBe('{"code":42}');
  });

  it("keeps unparseable JSON rather than losing it", () => {
    expect(formatUpstreamDetail('{"message": "truncated')).toBe('{"message": "truncated');
  });

  it("collapses to one line — a status field cannot show an HTML page", () => {
    expect(formatUpstreamDetail("<html>\n  <body>\n    Bad gateway\n  </body>\n</html>")).toBe(
      "<html> <body> Bad gateway </body> </html>",
    );
  });

  it("caps the length, because the stored status is capped too", () => {
    const long = "x".repeat(500);
    const out = formatUpstreamDetail(long);
    expect(out.length).toBe(UPSTREAM_DETAIL_LIMIT);
    expect(out.endsWith("…")).toBe(true);
  });

  it("redacts a secret the upstream quoted back at us", () => {
    const token = "access-token-abcdefghijklmnop";
    expect(formatUpstreamDetail(`Bad token ${token} supplied`, { secrets: [token] })).toBe(
      `Bad token ${REDACTED} supplied`,
    );
  });

  it("redacts every occurrence, not just the first", () => {
    const token = "access-token-abcdefghijklmnop";
    const out = formatUpstreamDetail(`${token} and again ${token}`, { secrets: [token] });
    expect(out).not.toContain(token);
    expect(out).toBe(`${REDACTED} and again ${REDACTED}`);
  });

  it("ignores absent secrets and short ones", () => {
    // A short "secret" would redact ordinary words out of the message; a real
    // credential is never this short.
    expect(formatUpstreamDetail("the key is bad", { secrets: [undefined, null, "key"] })).toBe(
      "the key is bad",
    );
  });

  it("redacts before truncating, so a secret cannot survive at the cut", () => {
    const token = "access-token-abcdefghijklmnop";
    const out = formatUpstreamDetail(`${"y".repeat(110)} ${token}`, { secrets: [token] });
    expect(out).not.toContain(token);
  });

  it("gives nothing back for an empty body", () => {
    expect(formatUpstreamDetail("")).toBe("");
    expect(formatUpstreamDetail("   \n  ")).toBe("");
  });
});

describe("withUpstreamDetail", () => {
  it("leads with our own summary, so it survives the status truncation", () => {
    expect(withUpstreamDetail("Brevo rejected the API key", "Key not found")).toBe(
      "Brevo rejected the API key — Key not found",
    );
  });

  it("says just the summary when the upstream said nothing", () => {
    expect(withUpstreamDetail("Brevo rejected the API key", "")).toBe("Brevo rejected the API key");
  });
});

describe("upstreamDetail", () => {
  it("reads the body off a response", async () => {
    const response = { text: () => Promise.resolve('{"message":"nope"}') } as unknown as Response;
    await expect(upstreamDetail(response)).resolves.toBe("nope");
  });

  it("gives nothing back rather than throwing when the body cannot be read", async () => {
    // This runs on a path that is already failing; a body that will not read
    // must not replace the caller's real error with one about reading it.
    const response = {
      text: () => Promise.reject(new Error("stream already consumed")),
    } as unknown as Response;
    await expect(upstreamDetail(response)).resolves.toBe("");
  });
});
