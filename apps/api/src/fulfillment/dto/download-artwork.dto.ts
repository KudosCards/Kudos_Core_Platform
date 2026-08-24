import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, MaxLength } from "class-validator";

export class DownloadArtworkDto {
  @ApiProperty({ description: "The fulfilment job whose card carries this artwork." })
  @IsUUID()
  jobId!: string;

  @ApiProperty({
    description:
      "The asset URL to download, exactly as it appears in the card's design document. Rejected if the design doesn't reference it — the server never fetches a URL on the client's word alone.",
  })
  @IsString()
  @MaxLength(2048)
  assetUrl!: string;
}
