import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "./image-loader";

/**
 * Every clip-art and sticker asset the editor offers must survive the print
 * decoder. The editor shows them with the browser's own SVG renderer, which has
 * no pixel budget, so an asset the print path refuses looks perfect on screen
 * and is simply missing from the printed card — which is how six of the
 * clip-art SVGs shipped. This walks the real `apps/web/public` folders, so a
 * newly added file that cannot print fails here rather than on a customer's card.
 */
const WEB_PUBLIC = join(__dirname, "../../../web/public");
const FOLDERS = ["clipart/greetings", "clipart/objects", "stickers"];

const assets = FOLDERS.flatMap((folder) =>
  readdirSync(join(WEB_PUBLIC, folder))
    .filter((file) => !file.includes(".thumb.") && /\.(svg|webp|png|jpe?g)$/i.test(file))
    .map((file) => `/${folder}/${file}`),
);

describe("bundled clip art and stickers", () => {
  it("finds the library", () => {
    expect(assets.length).toBeGreaterThan(0);
  });

  it.each(assets)("%s decodes for print", async (asset) => {
    const warnings: string[] = [];
    const resolved = await decodeImage(readFileSync(join(WEB_PUBLIC, asset)), null, asset, {
      onWarn: (message) => warnings.push(message),
    });
    expect(warnings).toEqual([]);
    expect(resolved).not.toBeNull();
    expect(Math.max(resolved!.width, resolved!.height)).toBeGreaterThanOrEqual(1024);
  });
});
