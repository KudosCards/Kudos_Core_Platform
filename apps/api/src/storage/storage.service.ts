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
