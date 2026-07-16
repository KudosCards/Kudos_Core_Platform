import { randomUUID } from "node:crypto";
import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DESIGN_ASSET_STORAGE_CLIENT } from "./design-asset-storage.provider";
import type { CreateUploadDto } from "./dto/create-upload.dto";

export const DESIGN_ASSETS_BUCKET = "design-assets";

export interface SignedUpload {
  path: string;
  token: string;
  publicUrl: string;
}

/**
 * Generates signed Storage upload URLs so the browser can upload an image
 * directly to Supabase Storage — the file bytes never pass through this API.
 * See docs/adr/0006-phase-2-scope.md for why the bucket is public-read
 * (design documents persist assetUrl indefinitely; a signed *read* URL would
 * expire and break saved designs).
 */
@Injectable()
export class StorageService {
  constructor(@Inject(DESIGN_ASSET_STORAGE_CLIENT) private readonly supabase: SupabaseClient) {}

  /**
   * `dto.contentType` is validated by CreateUploadDto for shape (must look
   * like an image MIME type) but is NOT enforced here — the installed
   * @supabase/storage-js version's `createSignedUploadUrl(path, options?)`
   * has no parameter to constrain what a client actually PUTs to the
   * resulting URL (confirmed against its type signature; `options` is only
   * `{ upsert }`). A client can request a URL claiming "image/png" and then
   * upload arbitrary bytes/content-type to it. Real enforcement has to come
   * from the `design-assets` Supabase Storage bucket's own configuration
   * (`allowedMimeTypes` / `fileSizeLimit`, set via the Supabase dashboard or
   * Management API) — this service has no code-level way to add it.
   */
  async createSignedUpload(accountId: string, dto: CreateUploadDto): Promise<SignedUpload> {
    const path = `${accountId}/${randomUUID()}-${sanitizeFileName(dto.fileName)}`;

    const { data, error } = await this.supabase.storage
      .from(DESIGN_ASSETS_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      throw new InternalServerErrorException(
        `Could not create an upload URL: ${error?.message ?? "unknown error"}`,
      );
    }

    const {
      data: { publicUrl },
    } = this.supabase.storage.from(DESIGN_ASSETS_BUCKET).getPublicUrl(data.path);

    return { path: data.path, token: data.token, publicUrl };
  }
}

/** Strips path separators and anything outside a safe filename charset. */
function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "upload";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
}
