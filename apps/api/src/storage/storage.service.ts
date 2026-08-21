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

/** Public-read, same model as the other buckets (unguessable per-account path).
 * Holds the screenshots + screen recordings customers attach to support tickets
 * so support can see the problem. See docs/adr/0079-support-attachments.md. */
export const SUPPORT_ATTACHMENTS_BUCKET = "support-attachments";

/** Image + video mime types the support uploader accepts, kept in one place so
 * the DTO's `contentType` pattern and the bucket's `allowedMimeTypes` agree. */
export const SUPPORT_ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

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
  /**
   * Whether anyone holding the URL can read the object.
   *
   * True for the buckets whose URLs are persisted and rendered indefinitely —
   * a card design or a message page stores its asset URL forever, and a signed
   * URL would expire and break it. False for anything holding customer
   * material, which is read through a short-lived signed URL instead.
   *
   * Declared here rather than set once by hand because `ensureBucketConfigured`
   * re-applies this on every boot: a bucket flipped in the Supabase dashboard
   * would be silently flipped back on the next deploy.
   */
  public: boolean;
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
    public: true,
  },
  {
    name: MESSAGE_VIDEOS_BUCKET,
    allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
    fileSizeLimit: "50MB",
    public: true,
  },
  {
    name: SUPPORT_ATTACHMENTS_BUCKET,
    allowedMimeTypes: SUPPORT_ATTACHMENT_MIME_TYPES,
    fileSizeLimit: "50MB",
    // Customers attach screenshots of their own screens: other people's names
    // and addresses, billing details, whatever else was open at the time.
    public: false,
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
    public: config.public,
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
      // Already there — re-apply the configured limits and visibility, so a
      // bucket created before this config existed (or changed by hand) is
      // brought back into line.
      const { error: updateError } = await client.storage.updateBucket(config.name, options);
      if (updateError) {
        // A private bucket that stayed public is a data-exposure failure, not a
        // tidiness one: everything already uploaded is readable by anyone with
        // the URL. It must not be swallowed at warn level with the size limits.
        if (config.public) {
          logger?.warn(`Could not update "${config.name}" bucket limits: ${updateError.message}`);
        } else {
          logger?.error(
            `"${config.name}" bucket could NOT be set private — customer files there are ` +
              `publicly readable until this succeeds: ${updateError.message}`,
          );
        }
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
 *
 * Buckets differ in how they're read. Design assets and message videos are
 * public-read: they persist their asset URL indefinitely and a signed URL would
 * expire and break them (docs/adr/0006-phase-2-scope.md). Support attachments
 * are private and read through `createSignedReadUrls` below, because they hold
 * customer material and are only ever viewed in an authenticated thread.
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

  /**
   * Short-lived read URLs for objects in a private bucket, signed in one round
   * trip rather than one per file — a support thread can carry several
   * attachments per message.
   *
   * Returns a map of path → URL. A path that can't be signed is simply absent
   * rather than throwing: one unreadable attachment must not take down the
   * whole ticket view, which is the thing support is trying to read.
   */
  async createSignedReadUrls(
    bucket: string,
    paths: string[],
    expiresInSeconds: number,
  ): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    if (paths.length === 0) {
      return urls;
    }

    const unique = [...new Set(paths)];
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrls(unique, expiresInSeconds);
    if (error || !data) {
      this.logger.error(
        `Could not sign ${unique.length} ${bucket} read URL(s): ${error?.message ?? "unknown error"}`,
      );
      return urls;
    }

    for (const entry of data) {
      // Supabase reports per-path failures inside the array rather than on
      // `error`, so a missing object shows up here, not above.
      if (entry.error || !entry.signedUrl || !entry.path) {
        this.logger.warn(
          `Could not sign "${entry.path ?? "unknown"}" in ${bucket}: ${entry.error ?? "no URL returned"}`,
        );
        continue;
      }
      urls.set(entry.path, entry.signedUrl);
    }
    return urls;
  }
}

/** Strips path separators and anything outside a safe filename charset. */
function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "upload";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
}
