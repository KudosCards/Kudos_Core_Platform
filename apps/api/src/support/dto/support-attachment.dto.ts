import {
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  Min,
} from "class-validator";

/** The support attachment media kinds — mirrors SupportAttachmentKind. */
export const SUPPORT_ATTACHMENT_KINDS = ["image", "video"] as const;
export type SupportAttachmentKindValue = (typeof SUPPORT_ATTACHMENT_KINDS)[number];

/**
 * A reference to a file already uploaded to the support-attachments bucket via a
 * signed URL. The customer PUTs the bytes to storage first, then submits the
 * resulting file reference alongside their message. See ADR 0079.
 */
export class SupportAttachmentInputDto {
  // Must be a real URL with a scheme (a bare string is otherwise treated as a
  // valid hostname). require_tld:false so a localhost storage host works in dev.
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(2000)
  url!: string;

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
