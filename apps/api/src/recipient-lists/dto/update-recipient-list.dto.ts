import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class UpdateRecipientListDto {
  @ApiProperty({ description: "New list name" })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}
