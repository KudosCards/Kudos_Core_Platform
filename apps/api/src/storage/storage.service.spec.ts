import { InternalServerErrorException } from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  StorageService,
  DESIGN_ASSETS_BUCKET,
  ensureBucketConfigured,
  type BucketConfig,
} from "./storage.service";

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

  describe("ensureBucketConfigured", () => {
    const config: BucketConfig = {
      name: "design-assets",
      allowedMimeTypes: ["image/png", "image/jpeg"],
      fileSizeLimit: "10MB",
    };

    it("creates the bucket public with its mime/size limits", async () => {
      const createBucket = jest.fn().mockResolvedValue({ data: { name: config.name }, error: null });
      const updateBucket = jest.fn();
      const client = { storage: { createBucket, updateBucket } } as unknown as SupabaseClient;

      await ensureBucketConfigured(client, config);

      expect(createBucket).toHaveBeenCalledWith(config.name, {
        public: true,
        allowedMimeTypes: config.allowedMimeTypes,
        fileSizeLimit: "10MB",
      });
      expect(updateBucket).not.toHaveBeenCalled();
    });

    it("updates an existing bucket so the limits are enforced on it too", async () => {
      const createBucket = jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: "The resource already exists" } });
      const updateBucket = jest.fn().mockResolvedValue({ data: null, error: null });
      const client = { storage: { createBucket, updateBucket } } as unknown as SupabaseClient;

      await ensureBucketConfigured(client, config);

      expect(updateBucket).toHaveBeenCalledWith(config.name, {
        public: true,
        allowedMimeTypes: config.allowedMimeTypes,
        fileSizeLimit: "10MB",
      });
    });

    it("swallows a thrown SDK/network error rather than crashing boot", async () => {
      const createBucket = jest.fn().mockRejectedValue(new Error("network down"));
      const client = { storage: { createBucket } } as unknown as SupabaseClient;

      await expect(ensureBucketConfigured(client, config)).resolves.toBeUndefined();
    });
  });
});
