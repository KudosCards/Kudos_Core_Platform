import sharp from "sharp";
import type { DesignDocument } from "@kudos/shared-types";
import {
  absoluteUrl,
  createImageResolver,
  decodeImage,
  hostOf,
  isHostAllowed,
  type FetchLike,
} from "./image-loader";
import { renderRunPdf } from "./render";

/** A tiny solid-colour raster in the requested format. */
async function raster(format: "png" | "webp" | "gif" | "jpeg"): Promise<Buffer> {
  const img = sharp({
    create: { width: 8, height: 6, channels: 4, background: { r: 200, g: 30, b: 90, alpha: 1 } },
  });
  if (format === "png") return img.png().toBuffer();
  if (format === "webp") return img.webp().toBuffer();
  if (format === "jpeg") return img.jpeg().toBuffer();
  return img.gif().toBuffer();
}

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#f00"/></svg>';

/** A copy of a Buffer's bytes as a standalone ArrayBuffer. */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

/** A fetch stub that always serves `buffer` with `contentType`, counting calls. */
function stubFetch(
  buffer: Buffer,
  contentType: string,
): { impl: FetchLike; readonly calls: number } {
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
    expect(absoluteUrl("/stickers/gift.svg", "https://app.kudos.co.uk")).toBe(
      "https://app.kudos.co.uk/stickers/gift.svg",
    );
  });
  it("returns null for a root-relative asset with no base URL", () => {
    expect(absoluteUrl("/stickers/gift.svg")).toBeNull();
  });
});

describe("decodeImage", () => {
  // This test used to assert the opposite — that PNG bytes were handed on as the
  // same Buffer, no re-encode. That was the defect, not the contract: pdfkit runs
  // its own PNG decoder and rethrows a zlib failure inside an async callback,
  // where nothing on this path can catch it and the process dies. Decoding it
  // ourselves is what makes a corrupt PNG a skipped asset. Deliberately changed,
  // not relaxed — engine-resilience.spec.ts is where the reason is pinned.
  it("re-encodes PNG rather than trusting the bytes, keeping its dimensions", async () => {
    const png = await raster("png");
    const resolved = await decodeImage(png, "image/png", "https://x/a.png");
    expect(resolved).not.toBeNull();
    expect(resolved!.data).not.toBe(png);
    expect((await sharp(resolved!.data).metadata()).format).toBe("png");
    expect(resolved!.width).toBe(8);
    expect(resolved!.height).toBe(6);
  });

  it("passes an unprofiled JPEG through untouched — pdfkit never decodes it", async () => {
    // No ICC profile means sRGB by convention, so the numbers are already the
    // ones the printer will read. Nothing to fix, and re-encoding would only
    // cost a generation of quality.
    const jpeg = await raster("jpeg");
    const resolved = await decodeImage(jpeg, "image/jpeg", "https://x/a.jpg");
    expect(resolved!.data).toBe(jpeg);
    expect(resolved!.width).toBe(8);
  });

  /**
   * The colour half of the print path. pdfkit writes no ICC profile into the PDF
   * (`COLOR_SPACE_MAP` is chosen by channel count), so whatever numbers reach it
   * are printed as device RGB. A JPEG that carries a wide-gamut profile
   * therefore has to be converted before it gets there, or the printer reads
   * Adobe RGB numbers as sRGB and every saturated colour lands muted.
   */
  describe("a JPEG carrying a colour profile", () => {
    /** sRGB green, stored in Display P3 — the same colour, different numbers. */
    async function wideGamutGreen(): Promise<Buffer> {
      const srgb = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 255, b: 0 } },
      })
        .png()
        .toBuffer();
      return sharp(srgb).withIccProfile("p3").jpeg({ quality: 100 }).toBuffer();
    }

    /**
     * The first pixel of a file that carries **no** profile, which is the only
     * case where this is safe: reading a *profiled* file back through `sharp`
     * converts it to sRGB on the way out, so measuring the input this way would
     * quietly show the answer we are trying to test for.
     */
    async function storedPixel(data: Buffer): Promise<number[]> {
      const { data: raw } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
      return [raw[0]!, raw[1]!, raw[2]!];
    }

    it("is not passed through", async () => {
      const jpeg = await wideGamutGreen();
      const resolved = await decodeImage(jpeg, "image/jpeg", "https://x/wide.jpg");
      expect(resolved!.data).not.toBe(jpeg);
    });

    it("lands on the card as sRGB numbers, not the profile's", async () => {
      // Display P3 stores this green at roughly (117, 251, 76) — verified by
      // decoding the PNG bytes by hand, since every route through `sharp`
      // converts it. Printed as device RGB those numbers are a duller, yellower
      // green than the customer chose. What must come out is sRGB's (0, 255, 0).
      const jpeg = await wideGamutGreen();
      expect((await sharp(jpeg).metadata()).icc).toBeDefined();

      const resolved = await decodeImage(jpeg, "image/jpeg", "https://x/wide.jpg");
      const [r, g, b] = await storedPixel(resolved!.data);
      expect(r).toBeLessThan(16);
      expect(g).toBeGreaterThan(240);
      expect(b).toBeLessThan(16);
    });

    it("carries no profile out, so nothing downstream converts it twice", async () => {
      const resolved = await decodeImage(await wideGamutGreen(), "image/jpeg", "https://x/w.jpg");
      expect((await sharp(resolved!.data).metadata()).icc).toBeUndefined();
    });

    it("keeps it a JPEG rather than inflating a photo into a PNG", async () => {
      const resolved = await decodeImage(await wideGamutGreen(), "image/jpeg", "https://x/w.jpg");
      expect((await sharp(resolved!.data).metadata()).format).toBe("jpeg");
    });

    it("bakes the EXIF rotation in and drops the tag, so it cannot turn twice", async () => {
      // The passthrough existed partly because pdfkit turns a JPEG itself. Once
      // we re-encode, the rotation has to be in the pixels *and* the tag gone —
      // either alone prints the card sideways.
      const srgb = await sharp({
        create: { width: 40, height: 20, channels: 3, background: { r: 0, g: 255, b: 0 } },
      })
        .png()
        .toBuffer();
      // `withMetadata({ orientation })` is the call that actually writes the
      // tag; `withExif({ IFD0: { Orientation } })` silently leaves it at 1.
      const rotated = await sharp(srgb)
        .withIccProfile("p3")
        .withMetadata({ orientation: 6 })
        .jpeg({ quality: 100 })
        .toBuffer();
      expect((await sharp(rotated).metadata()).orientation).toBe(6);

      const resolved = await decodeImage(rotated, "image/jpeg", "https://x/turned.jpg");
      const meta = await sharp(resolved!.data).metadata();

      expect(meta.orientation).toBeUndefined();
      // Orientation 6 is a quarter turn, so a 40x20 source prints 20x40. The
      // pixels must have actually moved, not just the reported numbers.
      expect(meta.width).toBe(20);
      expect(meta.height).toBe(40);
      expect(resolved!.width).toBe(20);
      expect(resolved!.height).toBe(40);
    });
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

  it("rasterises an SVG with a huge viewBox instead of refusing it", async () => {
    // The shape of `happy_birthday_woods_color.svg`: a 5094x2824 viewBox and no
    // width or height. At a fixed density of 384 that asked for 409 megapixels,
    // over the decode limit, and the clip art was left off the printed card.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5094 2824">' +
      '<rect width="5094" height="2824" fill="#f00"/></svg>';
    const warnings: string[] = [];
    const resolved = await decodeImage(Buffer.from(svg), "image/svg+xml", "https://x/big.svg", {
      onWarn: (message) => warnings.push(message),
    });
    expect(warnings).toEqual([]);
    expect(resolved).not.toBeNull();
    expect(resolved!.width).toBe(1024);
    expect(resolved!.height).toBe(Math.round((1024 * 2824) / 5094));
  });

  it("returns null for undecodable bytes", async () => {
    const resolved = await decodeImage(
      Buffer.from("not an image"),
      "application/octet-stream",
      "https://x/a.bin",
    );
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
      Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => null },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    const resolve = createImageResolver({ fetchImpl });
    await expect(resolve("https://x/missing.png")).resolves.toBeNull();
  });

  it("rejects an asset over the byte cap", async () => {
    const png = await raster("png");
    const resolve = createImageResolver({
      fetchImpl: stubFetch(png, "image/png").impl,
      maxBytes: 4,
    });
    await expect(resolve("https://x/a.png")).resolves.toBeNull();
  });

  it("rejects a host outside the allowlist without fetching (SSRF guard)", async () => {
    const png = await raster("png");
    const fetch = stubFetch(png, "image/png");
    const resolve = createImageResolver({
      fetchImpl: fetch.impl,
      allowedHosts: ["storage.kudos.co.uk"],
    });
    await expect(resolve("http://169.254.169.254/latest/meta-data/")).resolves.toBeNull();
    expect(fetch.calls).toBe(0); // never dialled out
  });

  it("allows a host on the allowlist", async () => {
    const png = await raster("png");
    const fetch = stubFetch(png, "image/png");
    const resolve = createImageResolver({
      fetchImpl: fetch.impl,
      allowedHosts: ["storage.kudos.co.uk"],
    });
    await expect(resolve("https://storage.kudos.co.uk/a.png")).resolves.not.toBeNull();
    expect(fetch.calls).toBe(1);
  });

  it("rejects on a declared Content-Length over the cap before buffering", async () => {
    let bufferRead = false;
    const fetchImpl: FetchLike = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: {
          get: (name) => (name.toLowerCase() === "content-length" ? "999999999" : "image/png"),
        },
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
    expect(isHostAllowed("https://evil.storage.kudos.co.uk/a", ["storage.kudos.co.uk"])).toBe(
      false,
    );
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
          {
            kind: "image",
            id: "i",
            assetUrl: "https://x/photo.png",
            x: 40,
            y: 40,
            width: 200,
            height: 150,
            rotation: 0,
          },
        ],
      },
    ],
  };

  it("draws image element + background when a resolver is supplied", async () => {
    const png = await raster("png");
    const resolve = createImageResolver({ fetchImpl: stubFetch(png, "image/png").impl });
    const withImg = await renderRunPdf([{ document: withImages, face: "front" }], {
      imageResolver: resolve,
    });
    const withoutImg = await renderRunPdf([{ document: withImages, face: "front" }]);
    expect(withImg.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // The embedded image bytes make the PDF materially larger than the skip path.
    expect(withImg.length).toBeGreaterThan(withoutImg.length);
  });
});
