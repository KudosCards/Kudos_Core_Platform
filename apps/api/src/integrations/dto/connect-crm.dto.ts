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

  /**
   * The sub-account to read from, for a provider that scopes contacts to one.
   *
   * Accepts the bare id or the whole dashboard address it was copied from —
   * see `parseLocationId`, which is also where a bad value is refused, so the
   * message can say which page to look at rather than "invalid".
   */
  @ApiPropertyOptional({
    description: "Sub-account ID, or the address of its dashboard. Required for LeadConnector.",
  })
  @IsOptional()
  @IsString()
  @Length(1, 300)
  externalAccountId?: string;

  @ApiPropertyOptional({ type: BrevoFieldMappingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrevoFieldMappingDto)
  fieldMapping?: BrevoFieldMappingDto;
}
