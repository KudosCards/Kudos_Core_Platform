import { InternalServerErrorException } from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StorageService, DESIGN_ASSETS_BUCKET } from "./storage.service";

describe("StorageService", () => {
  const accountId = "11111111-1111-1111-1111-111111111111";

  function buildMockClient(overrides?: {
    createSignedUploadUrl?: jest.Mock;
    getPublicUrl?: jest.Mock;
  }): { client: SupabaseClient; from: jest.Mock } {
    const from = jest.fn().mockReturnValue({
      createSignedUploadUrl:
        overrides?.createSignedUploadUrl ??
        jest.fn().mockResolvedValue({
          data: {
            signedUrl: "https://example.supabase.co/upload",
            token: "tok",
            path: "some/path.png",
          },
          error: null,
        }),
      getPublicUrl:
        overrides?.getPublicUrl ??
        jest
          .fn()
          .mockReturnValue({
            data: { publicUrl: "https://example.supabase.co/public/some/path.png" },
          }),
    });
    return { client: { storage: { from } } as unknown as SupabaseClient, from };
  }

  it("creates a signed upload scoped to the account, in the design-assets bucket", async () => {
    const { client, from } = buildMockClient();
    const service = new StorageService(client);

    const result = await service.createSignedUpload(DESIGN_ASSETS_BUCKET, accountId, {
      fileName: "photo.png",
      contentType: "image/png",
    });

    expect(result).toEqual({
      path: "some/path.png",
      token: "tok",
      publicUrl: "https://example.supabase.co/public/some/path.png",
    });
    expect(from).toHaveBeenCalledWith(DESIGN_ASSETS_BUCKET);
  });

  it("scopes the generated path under the account and sanitises the file name", async () => {
    const createSignedUploadUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: "url", token: "tok", path: "n/a" },
      error: null,
    });
    const { client } = buildMockClient({ createSignedUploadUrl });
    const service = new StorageService(client);

    await service.createSignedUpload(DESIGN_ASSETS_BUCKET, accountId, {
      fileName: "../../etc/passwd.png",
      contentType: "image/png",
    });

    const [path] = createSignedUploadUrl.mock.calls[0] as [string];
    expect(path.startsWith(`${accountId}/`)).toBe(true);
    expect(path).not.toContain("..");
    expect(path).not.toContain("/etc/");
  });

  it("throws a clean error when Supabase Storage returns an error", async () => {
    const createSignedUploadUrl = jest
      .fn()
      .mockResolvedValue({ data: null, error: { message: "bucket not found" } });
    const { client } = buildMockClient({ createSignedUploadUrl });
    const service = new StorageService(client);

    await expect(
      service.createSignedUpload(DESIGN_ASSETS_BUCKET, accountId, {
        fileName: "a.png",
        contentType: "image/png",
      }),
    ).rejects.toThrow(InternalServerErrorException);
  });
});
