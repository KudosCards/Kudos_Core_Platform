import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";

/** A support attachment upload: a screenshot (image/*) or a screen recording
 * (video/*). The bucket enforces the actual bytes; this validates the claim. */
export class CreateSupportUploadDto {
  @ApiProperty()
  @IsString()
  @Length(1, 200)
  fileName!: string;

  @ApiProperty({ description: "Must be an accepted image/* or video/* MIME type" })
  @IsString()
  @Matches(/^(image\/(png|jpe?g|webp|gif)|video\/(mp4|quicktime|webm))$/, {
    message:
      "contentType must be an image (png, jpeg, webp, gif) or video (mp4, quicktime, webm)",
  })
  contentType!: string;
}
