import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsString, Length, ValidateNested } from "class-validator";
import { SUPPORTED_PROVIDERS } from "../crm-connections.service";
import { BrevoFieldMappingDto } from "./brevo-field-mapping.dto";

export class ConnectCrmDto {
  @ApiProperty({ enum: SUPPORTED_PROVIDERS })
  @IsIn([...SUPPORTED_PROVIDERS])
  provider!: string;

  @ApiProperty({ description: "The CRM API key — stored encrypted, never returned." })
  @IsString()
  @Length(1, 300)
  apiKey!: string;

  @ApiPropertyOptional({ type: BrevoFieldMappingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrevoFieldMappingDto)
  fieldMapping?: BrevoFieldMappingDto;
}
