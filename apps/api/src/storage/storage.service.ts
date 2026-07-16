import { randomUUID } from "node:crypto";
import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DESIGN_ASSET_STORAGE_CLIENT } from "./design-asset-storage.provider";
import type { CreateUploadDto } from "./dto/create-upload.dto";

export const DESIGN_ASSETS_BUCKET = "design-assets";
/** Public-read, same as design-assets — a message page's video is viewed
 * from an unauthenticated public page, so it needs to be fetchable the same
 * way. See docs/adr/0009-phase-4-message-pages.md for why a fileSizeLimit
 * on this bucket (set via the Supabase dashboard) matters more here than it
 * does for card images. */
export const MESSAGE_VIDEOS_BUCKET = "message-videos";

export interface SignedUpload {
  path: string;
  token: string;
  publicUrl: string;
}

/**
 * Generates signed Storage upload URLs so the browser can upload a file
 * directly to Supabase Storage — the file bytes never pass through this API.
 * See docs/adr/0006-phase-2-scope.md for why buckets are public-read
 * (design documents and message pages persist their asset URL indefinitely;
 * a signed *read* URL would expire and break them).
 */
@Injectable()
export class StorageService {
  constructor(@Inject(DESIGN_ASSET_STORAGE_CLIENT) private readonly supabase: SupabaseClient) {}

  /**
   * `dto.contentType` is validated by the caller's DTO for shape (must look
   * like an image/video MIME type) but is NOT enforced here — the installed
   * @supabase/storage-js version's `createSignedUploadUrl(path, options?)`
   * has no parameter to constrain what a client actually PUTs to the
   * resulting URL (confirmed against its type signature; `options` is only
   * `{ upsert }`). A client can request a URL claiming "image/png" and then
   * upload arbitrary bytes/content-type to it. Real enforcement has to come
   * from the bucket's own configuration (`allowedMimeTypes` / `fileSizeLimit`,
   * set via the Supabase dashboard or Management API) — this service has no
   * code-level way to add it.
   */
  async createSignedUpload(
    bucket: string,
    accountId: string,
    dto: CreateUploadDto,
  ): Promise<SignedUpload> {
    const path = `${accountId}/${randomUUID()}-${sanitizeFileName(dto.fileName)}`;

    const { data, error } = await this.supabase.storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) {
      throw new InternalServerErrorException(
        `Could not create an upload URL: ${error?.message ?? "unknown error"}`,
      );
    }

    const {
      data: { publicUrl },
    } = this.supabase.storage.from(bucket).getPublicUrl(data.path);

    return { path: data.path, token: data.token, publicUrl };
  }
}

/** Strips path separators and anything outside a safe filename charset. */
function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "upload";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
}
