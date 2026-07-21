import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class CreateRecipientListDto {
  @ApiProperty({ description: 'List name, e.g. "Year 4 class"' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}
