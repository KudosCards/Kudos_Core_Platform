import { IsIn, IsInt, IsOptional, IsString, IsUrl, Length, MaxLength, Min } from "class-validator";

/** The support attachment media kinds — mirrors SupportAttachmentKind. */
export const SUPPORT_ATTACHMENT_KINDS = ["image", "video"] as const;
export type SupportAttachmentKindValue = (typeof SUPPORT_ATTACHMENT_KINDS)[number];

/**
 * A reference to a file already uploaded to the support-attachments bucket via a
 * signed URL. The customer PUTs the bytes to storage first, then submits the
 * resulting file reference alongside their message. See ADR 0079.
 */
export class SupportAttachmentInputDto {
  /**
   * Object path in the support-attachments bucket, from the signed upload.
   * Checked against the caller's account before it is stored — see
   * `resolveAttachmentPath` in the service.
   */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  path?: string;

  /**
   * Legacy public URL, still accepted so a browser on the previous build can
   * attach files mid-deploy. The path is derived from it and checked the same
   * way. Must be a real URL with a scheme (a bare string is otherwise treated
   * as a valid hostname); require_tld:false so a localhost storage host works
   * in dev.
   */
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(2000)
  url?: string;

  @IsString()
  @Length(1, 200)
  fileName!: string;

  @IsString()
  @Length(1, 120)
  contentType!: string;

  @IsInt()
  @Min(0)
  sizeBytes!: number;

  @IsIn(SUPPORT_ATTACHMENT_KINDS)
  kind!: SupportAttachmentKindValue;
}
