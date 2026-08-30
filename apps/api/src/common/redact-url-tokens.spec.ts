import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REDACTED, redactUrlTokens } from "./redact-url-tokens";
import { redactingReqSerializer } from "./logger.options";

describe("redactUrlTokens", () => {
  it("redacts an invite token but keeps the route readable", () => {
    expect(redactUrlTokens("/invites/pQ7abcDEF123/accept")).toBe(`/invites/${REDACTED}/accept`);
  });

  it("redacts a returns token, including on the bare read", () => {
    expect(redactUrlTokens("/rts/tok_abc123")).toBe(`/rts/${REDACTED}`);
    expect(redactUrlTokens("/rts/tok_abc123/address")).toBe(`/rts/${REDACTED}/address`);
    expect(redactUrlTokens("/rts/tok_abc123/send-to-business")).toBe(
      `/rts/${REDACTED}/send-to-business`,
    );
  });

  it("redacts a guest claim token", () => {
    expect(redactUrlTokens("/guest/claim/tok_abc123")).toBe(`/guest/claim/${REDACTED}`);
  });

  it("keeps the query string, which carries no secret", () => {
    expect(redactUrlTokens("/rts/tok_abc/address?from=email")).toBe(
      `/rts/${REDACTED}/address?from=email`,
    );
  });

  it("leaves ordinary URLs alone", () => {
    expect(redactUrlTokens("/recipients?page=2")).toBe("/recipients?page=2");
    expect(redactUrlTokens("/guest/cart-checkout")).toBe("/guest/cart-checkout");
    expect(redactUrlTokens("/")).toBe("/");
  });

  it("does not invent a token where there is none", () => {
    expect(redactUrlTokens("/invites/")).toBe("/invites/");
  });
});

/**
 * The list above is only right while it matches the routes that actually take a
 * token in the path. A new one added elsewhere would log in full and nothing
 * would say so — so the source is scanned rather than trusted.
 */
describe("every :token route is covered by a redaction prefix", () => {
  const SRC = join(__dirname, "..");

  function controllerFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return controllerFiles(full);
      return entry.name.endsWith(".controller.ts") ? [full] : [];
    });
  }

  it("finds no :token route outside the redacted prefixes", () => {
    const uncovered: string[] = [];
    for (const file of controllerFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      const controller = /@Controller\("([^"]*)"\)/.exec(source)?.[1] ?? "";
      for (const match of source.matchAll(
        /@(?:Get|Post|Put|Patch|Delete)\("([^"]*:token[^"]*)"\)/g,
      )) {
        const path = `/${controller}/${match[1]}`.replace(/\/+/g, "/");
        if (
          redactUrlTokens(path.replace(":token", "SECRET")) === path.replace(":token", "SECRET")
        ) {
          uncovered.push(path);
        }
      }
    }
    expect(uncovered).toEqual([]);
  });
});

describe("the logger's request serializer", () => {
  it("logs the route but not the token", () => {
    const serialized = redactingReqSerializer({
      id: 1,
      method: "POST",
      url: "/invites/pQ7abcDEF123/accept",
      headers: { host: "api.kudoscards.co.uk" },
      remoteAddress: "10.0.0.1",
      remotePort: 4000,
    });

    expect(serialized.url).toBe(`/invites/${REDACTED}/accept`);
    expect(JSON.stringify(serialized)).not.toContain("pQ7abcDEF123");
    // The rest of the line still has to be useful for debugging.
    expect(serialized).toMatchObject({ method: "POST", remoteAddress: "10.0.0.1" });
  });

  it("passes an ordinary request through untouched", () => {
    expect(redactingReqSerializer({ method: "GET", url: "/recipients?page=2" }).url).toBe(
      "/recipients?page=2",
    );
  });
});
