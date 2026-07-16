import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";

export class CreateUploadDto {
  @ApiProperty()
  @IsString()
  @Length(1, 200)
  fileName!: string;

  @ApiProperty({ description: "Must be an image/* MIME type" })
  @IsString()
  @Matches(/^image\/(png|jpe?g|webp|gif)$/, {
    message: "contentType must be one of image/png, image/jpeg, image/webp, image/gif",
  })
  contentType!: string;
}
