import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";

export class CreateVideoUploadDto {
  @ApiProperty()
  @IsString()
  @Length(1, 200)
  fileName!: string;

  @ApiProperty({ description: "Must be a video/* MIME type" })
  @IsString()
  @Matches(/^video\/(mp4|quicktime|webm)$/, {
    message: "contentType must be one of video/mp4, video/quicktime, video/webm",
  })
  contentType!: string;
}
