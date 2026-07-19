import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from "class-validator";
import { ExternalContactDto } from "./external-contact.dto";

export class IngestContactsDto {
  @ApiProperty({ type: [ExternalContactDto], description: "Up to 500 contacts per request." })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ExternalContactDto)
  contacts!: ExternalContactDto[];
}
