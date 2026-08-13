import sharp from "sharp";
import type { DesignDocument } from "@kudos/shared-types";
import { absoluteUrl, createImageResolver, decodeImage, hostOf, isHostAllowed, type FetchLike } from "./image-loader";
import { renderRunPdf } from "./render";

/** A tiny solid-colour raster in the requested format. */
async function raster(format: "png" | "webp" | "gif"): Promise<Buffer> {
  const img = sharp({ create: { width: 8, height: 6, channels: 4, background: { r: 200, g: 30, b: 90, alpha: 1 } } });
  if (format === "png") return img.png().toBuffer();
  if (format === "webp") return img.webp().toBuffer();
  return img.gif().toBuffer();
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#f00"/></svg>';

/** A copy of a Buffer's bytes as a standalone ArrayBuffer. */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/** A fetch stub that always serves `buffer` with `contentType`, counting calls. */
function stubFetch(buffer: Buffer, contentType: string): { impl: FetchLike; readonly calls: number } {
  let calls = 0;
  const impl: FetchLike = () => {
    calls += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => contentType },
      arrayBuffer: () => Promise.resolve(toArrayBuffer(buffer)),
    });
  };
  return {
    impl,
    get calls() {
      return calls;
    },
  };
}

describe("absoluteUrl", () => {
  it("passes http(s) URLs through", () => {
    expect(absoluteUrl("https://cdn/x.png")).toBe("https://cdn/x.png");
  });
  it("resolves a root-relative asset against the web base URL", () => {
    expect(absoluteUrl("/stickers/gift.svg", "https://app.kudos.co.uk")).toBe("https://app.kudos.co.uk/stickers/gift.svg");
  });
  it("returns null for a root-relative asset with no base URL", () => {
    expect(absoluteUrl("/stickers/gift.svg")).toBeNull();
  });
});

describe("decodeImage", () => {
  it("passes PNG through untouched with its dimensions", async () => {
    const png = await raster("png");
    const resolved = await decodeImage(png, "image/png", "https://x/a.png");
    expect(resolved).not.toBeNull();
    expect(resolved!.data).toBe(png); // same buffer, no re-encode
    expect(resolved!.width).toBe(8);
    expect(resolved!.height).toBe(6);
  });

  it("transcodes WebP to PNG for pdfkit", async () => {
    const webp = await raster("webp");
    const resolved = await decodeImage(webp, "image/webp", "https://x/a.webp");
    expect(resolved).not.toBeNull();
    expect((await sharp(resolved!.data).metadata()).format).toBe("png");
    expect(resolved!.width).toBe(8);
  });

  it("rasterises an SVG to a crisp PNG", async () => {
    const resolved = await decodeImage(Buffer.from(SVG), "image/svg+xml", "https://x/a.svg");
    expect(resolved).not.toBeNull();
    expect((await sharp(resolved!.data).metadata()).format).toBe("png");
    // Longest edge scaled up to the raster size.
    expect(Math.max(resolved!.width, resolved!.height)).toBe(1024);
  });

  it("returns null for undecodable bytes", async () => {
    const resolved = await decodeImage(Buffer.from("not an image"), "application/octet-stream", "https://x/a.bin");
    expect(resolved).toBeNull();
  });
});

describe("createImageResolver", () => {
  it("fetches and decodes an asset once, caching by URL", async () => {
    const png = await raster("png");
    const fetch = stubFetch(png, "image/png");
    const resolve = createImageResolver({ fetchImpl: fetch.impl });
    const a = await resolve("https://x/a.png");
    const b = await resolve("https://x/a.png");
    expect(a).toEqual(b);
    expect(fetch.calls).toBe(1); // second call served from cache
  });

  it("resolves to null on a non-OK response without throwing", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    const resolve = createImageResolver({ fetchImpl });
    await expect(resolve("https://x/missing.png")).resolves.toBeNull();
  });

  it("rejects an asset over the byte cap", async () => {
    const png = await raster("png");
    const resolve = createImageResolver({ fetchImpl: stubFetch(png, "image/png").impl, maxBytes: 4 });
    await expect(resolve("https://x/a.png")).resolves.toBeNull();
  });

  it("rejects a host outside the allowlist without fetching (SSRF guard)", async () => {
    const png = await raster("png");
    const fetch = stubFetch(png, "image/png");
    const resolve = createImageResolver({ fetchImpl: fetch.impl, allowedHosts: ["storage.kudos.co.uk"] });
    await expect(resolve("http://169.254.169.254/latest/meta-data/")).resolves.toBeNull();
    expect(fetch.calls).toBe(0); // never dialled out
  });

  it("allows a host on the allowlist", async () => {
    const png = await raster("png");
    const fetch = stubFetch(png, "image/png");
    const resolve = createImageResolver({ fetchImpl: fetch.impl, allowedHosts: ["storage.kudos.co.uk"] });
    await expect(resolve("https://storage.kudos.co.uk/a.png")).resolves.not.toBeNull();
    expect(fetch.calls).toBe(1);
  });

  it("rejects on a declared Content-Length over the cap before buffering", async () => {
    let bufferRead = false;
    const fetchImpl: FetchLike = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: (name) => (name.toLowerCase() === "content-length" ? "999999999" : "image/png") },
        arrayBuffer: () => {
          bufferRead = true;
          return Promise.resolve(new ArrayBuffer(8));
        },
      });
    const resolve = createImageResolver({ fetchImpl, maxBytes: 1024 });
    await expect(resolve("https://x/huge.png")).resolves.toBeNull();
    expect(bufferRead).toBe(false); // rejected on the header, body never read
  });
});

describe("isHostAllowed / hostOf", () => {
  it("is unrestricted when no allowlist is given", () => {
    expect(isHostAllowed("http://anything/x", undefined)).toBe(true);
  });
  it("matches host case-insensitively and exactly (no subdomain widening)", () => {
    expect(isHostAllowed("https://Storage.Kudos.co.uk/a", ["storage.kudos.co.uk"])).toBe(true);
    expect(isHostAllowed("https://evil.storage.kudos.co.uk/a", ["storage.kudos.co.uk"])).toBe(false);
    expect(isHostAllowed("https://other/a", ["storage.kudos.co.uk"])).toBe(false);
  });
  it("blocks everything for an empty allowlist", () => {
    expect(isHostAllowed("https://x/a", [])).toBe(false);
  });
  it("extracts a hostname from a config URL", () => {
    expect(hostOf("https://proj.supabase.co/storage")).toBe("proj.supabase.co");
    expect(hostOf("not a url")).toBeNull();
  });
});

describe("renderRunPdf with images", () => {
  const withImages: DesignDocument = {
    version: 1,
    pages: [
      {
        name: "front",
        background: { type: "image", assetUrl: "https://x/bg.png" },
        elements: [
          { kind: "image", id: "i", assetUrl: "https://x/photo.png", x: 40, y: 40, width: 200, height: 150, rotation: 0 },
        ],
      },
    ],
  };

  it("draws image element + background when a resolver is supplied", async () => {
    const png = await raster("png");
    const resolve = createImageResolver({ fetchImpl: stubFetch(png, "image/png").impl });
    const withImg = await renderRunPdf([{ document: withImages, face: "front" }], { imageResolver: resolve });
    const withoutImg = await renderRunPdf([{ document: withImages, face: "front" }]);
    expect(withImg.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // The embedded image bytes make the PDF materially larger than the skip path.
    expect(withImg.length).toBeGreaterThan(withoutImg.length);
  });
});
