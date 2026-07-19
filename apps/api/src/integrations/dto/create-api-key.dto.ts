import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class CreateApiKeyDto {
  @ApiProperty({ description: "A human label so you can tell your keys apart (e.g. 'Brevo sync')." })
  @IsString()
  @Length(1, 80)
  label!: string;
}
