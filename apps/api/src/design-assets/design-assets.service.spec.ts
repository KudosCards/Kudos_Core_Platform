import sharp from "sharp";
import type { ConfigService } from "@nestjs/config";
import type * as PrintPdf from "../print-pdf";
import type { EnvConfig } from "../config/env.schema";
import type { PrismaService } from "../prisma/prisma.service";
import { fetchAssetBytes } from "../print-pdf";
import { DesignAssetsService } from "./design-assets.service";

// Only the network is faked. The host allowlist, the `sharp` read and the
// orientation correction all run for real — they are the parts worth testing.
jest.mock("../print-pdf", () => ({
  ...jest.requireActual<typeof PrintPdf>("../print-pdf"),
  fetchAssetBytes: jest.fn(),
}));
const fetchMock = fetchAssetBytes as jest.MockedFunction<typeof fetchAssetBytes>;

/**
 * What goes in the library row, and where the number came from.
 *
 * `DesignAsset.width/height` used to be whatever the browser posted. They decide
 * what the editor believes about a file and what the artwork gate would say
 * about it, and a figure the client supplies can answer neither — a stale tab or
 * a forged request supplies it too. See docs/card-print-quality-plan.md (P7).
 */
describe("DesignAssetsService.create", () => {
  const STORAGE = "https://store.supabase.co";
  const url = (name: string) => `${STORAGE}/storage/v1/object/public/design-assets/u/${name}`;

  const created: Record<string, unknown>[] = [];
  const prisma = {
    designAsset: {
      create: (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({ id: "a1", createdAt: new Date(), ...args.data });
      },
    },
  } as unknown as PrismaService;

  const config = { get: () => STORAGE } as unknown as ConfigService<EnvConfig, true>;
  const service = new DesignAssetsService(prisma, config);

  /** Real bytes, so the measurement is the one production performs. */
  async function png(width: number, height: number, orientation?: number): Promise<Buffer> {
    const image = sharp({
      create: { width, height, channels: 3, background: { r: 120, g: 120, b: 120 } },
    });
    return (orientation ? image.withMetadata({ orientation }) : image).png().toBuffer();
  }

  function serve(bytes: Record<string, Buffer | null>) {
    fetchMock.mockImplementation((assetUrl: string) => {
      const found = bytes[assetUrl];
      return Promise.resolve(found ? { buffer: found, contentType: "image/png" } : null);
    });
  }

  beforeEach(() => {
    created.length = 0;
    fetchMock.mockReset();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("overrules a client that claims the wrong size", async () => {
    // The whole point. A stale tab or a forged request can post any numbers it
    // likes; the bytes in storage can only be one size.
    const asset = url("real.png");
    serve({ [asset]: await png(1240, 1748) });

    await service.create("acct", { url: asset, fileName: "a.png", width: 100, height: 100 });

    expect(created[0]).toMatchObject({ width: 1240, height: 1748 });
  });

  it("records a rotated photo the way it will be shown, not the way it is stored", async () => {
    // The correction a browser's `naturalWidth` does not make, and the reason
    // the catalog used to call a correctly-shaped portrait photo a cropped
    // landscape. See ADR 0247.
    const asset = url("phone.png");
    serve({ [asset]: await png(1748, 1240, 6) });

    await service.create("acct", { url: asset, fileName: "p.png" });

    expect(created[0]).toMatchObject({ width: 1240, height: 1748 });
  });

  it("falls back to the client's figure when storage does not answer", async () => {
    // A blip must not stop an upload appearing in the library, and no dimensions
    // at all is the bug that placed every photo as a square.
    const asset = url("gone.png");
    serve({ [asset]: null });

    await service.create("acct", { url: asset, fileName: "g.png", width: 800, height: 600 });

    expect(created[0]).toMatchObject({ width: 800, height: 600 });
  });

  it("falls back when the bytes are not an image", async () => {
    const asset = url("junk.png");
    serve({ [asset]: Buffer.from("this is not a picture") });

    await service.create("acct", { url: asset, fileName: "j.png", width: 640, height: 480 });

    expect(created[0]).toMatchObject({ width: 640, height: 480 });
  });

  it("never fetches a URL that is not our storage", async () => {
    // The url arrives in a request body, so an unrestricted server-side fetch
    // here would be the confused-deputy SSRF the print engine is allowlisted
    // against.
    await service.create("acct", {
      url: "https://cdn.example.com/someone-elses.png",
      fileName: "x.png",
      width: 10,
      height: 10,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(created[0]).toMatchObject({ width: 10, height: 10 });
  });

  it("stores nothing rather than guessing when neither side knows", async () => {
    const asset = url("unknown.png");
    serve({ [asset]: null });

    await service.create("acct", { url: asset, fileName: "u.png" });

    expect(created[0]).toMatchObject({ width: null, height: null });
  });
});
