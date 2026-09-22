import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import {
  STANDING_ORDER_MAX_DESIGNS,
  STANDING_ORDER_MAX_MESSAGES,
  STANDING_ORDER_MESSAGE_MAX_LENGTH,
} from "@kudos/shared-types";

/** Which contacts the instruction covers. `all` needs no id; the other two do,
 * and the service checks the id belongs to the caller's account. */
export class StandingOrderAudienceDto {
  @ApiProperty({ enum: ["all", "list", "segment"] })
  @IsIn(["all", "list", "segment"])
  kind!: "all" | "list" | "segment";

  @ApiPropertyOptional({ description: "Required when kind is 'list'" })
  @IsOptional()
  @IsUUID()
  listId?: string;

  @ApiPropertyOptional({ description: "Required when kind is 'segment'" })
  @IsOptional()
  @IsUUID()
  segmentId?: string;
}

export class StandingOrderMessageDto {
  @ApiProperty({ description: "Card message; merge tokens like {firstName} are resolved at print" })
  @IsString()
  @MinLength(1)
  @MaxLength(STANDING_ORDER_MESSAGE_MAX_LENGTH)
  text!: string;

  @ApiPropertyOptional({ enum: ["written", "assisted"], default: "written" })
  @IsOptional()
  @IsEnum({ written: "written", assisted: "assisted" })
  source?: "written" | "assisted";
}

/**
 * The whole instruction, every time.
 *
 * Whole rather than patched, for the reason the automatic top-up is
 * (ADR 0255): switching this on without saying which cards and which words is
 * not a decision anybody made.
 */
export class SaveStandingOrderDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ type: StandingOrderAudienceDto })
  @ValidateNested()
  @Type(() => StandingOrderAudienceDto)
  audience!: StandingOrderAudienceDto;

  @ApiProperty({ enum: ["first_class", "second_class"] })
  @IsIn(["first_class", "second_class"])
  postageClass!: "first_class" | "second_class";

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(STANDING_ORDER_MAX_DESIGNS)
  @IsUUID(undefined, { each: true })
  savedDesignIds!: string[];

  @ApiProperty({ type: [StandingOrderMessageDto] })
  @IsArray()
  @ArrayMaxSize(STANDING_ORDER_MAX_MESSAGES)
  @ValidateNested({ each: true })
  @Type(() => StandingOrderMessageDto)
  messages!: StandingOrderMessageDto[];

  /**
   * True when the caller is agreeing to the statement the API returned.
   *
   * Separate from `enabled` on purpose: agreeing and switching on are two acts,
   * and somebody turning it back on months later should not silently re-agree
   * to wording they have not been shown.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  agreeToConsent?: boolean;
}
