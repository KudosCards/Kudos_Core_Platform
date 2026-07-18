import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DESIGN_ASSET_STORAGE_CLIENT } from "./design-asset-storage.provider";
import type { CreateUploadDto } from "./dto/create-upload.dto";

export const DESIGN_ASSETS_BUCKET = "design-assets";
/** Public-read, same as design-assets — a message page's video is viewed
 * from an unauthenticated public page, so it needs to be fetchable the same
 * way. See docs/adr/0009-phase-4-message-pages.md. */
export const MESSAGE_VIDEOS_BUCKET = "message-videos";

/** A storage bucket plus the upload limits Supabase enforces on it. */
export interface BucketConfig {
  name: string;
  /**
   * The mime types the bucket will accept. These mirror the upload DTOs'
   * `contentType` patterns (`create-upload.dto.ts` / `create-video-upload.dto.ts`):
   * the DTO validates the *claimed* type, the bucket enforces the *actual*
   * bytes a client PUTs to the signed URL (see `createSignedUpload`).
   */
  allowedMimeTypes: string[];
  /** Max upload size, as a Supabase size string (e.g. "10MB"). */
  fileSizeLimit: string;
}

/**
 * Single source of truth for the app's storage buckets and their limits.
 * `ensureBuckets()` applies this at boot so the limits are enforced
 * automatically rather than being a manual dashboard step (go-live runbook
 * §1a). Design assets are images only (card artwork + designer uploads);
 * message videos allow the three formats the personalise flow accepts.
 */
export const BUCKET_CONFIGS: readonly BucketConfig[] = [
  {
    name: DESIGN_ASSETS_BUCKET,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    fileSizeLimit: "10MB",
  },
  {
    name: MESSAGE_VIDEOS_BUCKET,
    allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
    fileSizeLimit: "50MB",
  },
];

/**
 * Idempotently creates `config.name` (public, with its mime/size limits) or —
 * if it already exists — updates it so the limits are always in force, even on
 * a bucket that was hand-created without them. Non-fatal: every failure is
 * logged and swallowed so it can never block API boot or a catalog sync. A
 * thrown error (e.g. the SDK method missing on a test double, or no network)
 * is caught the same way as a Supabase-returned error.
 */
export async function ensureBucketConfigured(
  client: SupabaseClient,
  config: BucketConfig,
  logger?: Logger,
): Promise<void> {
  const options = {
    public: true,
    allowedMimeTypes: [...config.allowedMimeTypes],
    fileSizeLimit: config.fileSizeLimit,
  };
  try {
    const { error } = await client.storage.createBucket(config.name, options);
    if (!error) {
      logger?.log(`Created storage bucket "${config.name}"`);
      return;
    }
    if (/exist/i.test(error.message)) {
      // Already there — enforce the current limits (and keep it public, so
      // stored public URLs keep rendering) on the existing bucket.
      const { error: updateError } = await client.storage.updateBucket(config.name, options);
      if (updateError) {
        logger?.warn(`Could not update "${config.name}" bucket limits: ${updateError.message}`);
      }
      return;
    }
    logger?.warn(`Could not ensure "${config.name}" bucket: ${error.message}`);
  } catch (error) {
    logger?.warn(
      `Could not ensure "${config.name}" bucket: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

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
export class StorageService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StorageService.name);

  constructor(@Inject(DESIGN_ASSET_STORAGE_CLIENT) private readonly supabase: SupabaseClient) {}

  /**
   * On a production boot, ensure both buckets exist with the correct
   * public/mime/size configuration (`BUCKET_CONFIGS`). This makes the upload
   * limits self-configuring rather than a manual dashboard step that's easy
   * to forget — and, crucially, the *only* real enforcement of what a client
   * uploads (see `createSignedUpload`). Skipped outside production so unit/e2e
   * boots never reach for the network; each ensure is non-fatal regardless.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    for (const config of BUCKET_CONFIGS) {
      await ensureBucketConfigured(this.supabase, config, this.logger);
    }
  }

  /**
   * `dto.contentType` is validated by the caller's DTO for shape (must look
   * like an image/video MIME type) but is NOT enforced here — the installed
   * @supabase/storage-js version's `createSignedUploadUrl(path, options?)`
   * has no parameter to constrain what a client actually PUTs to the
   * resulting URL (confirmed against its type signature; `options` is only
   * `{ upsert }`). A client can request a URL claiming "image/png" and then
   * upload arbitrary bytes/content-type to it. The real guard is the bucket's
   * own `allowedMimeTypes` / `fileSizeLimit`, which `onApplicationBootstrap`
   * applies from `BUCKET_CONFIGS` on every production deploy.
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
