import { ApiProperty } from "@nestjs/swagger";
import { DispatchOption, PostageClass } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";
import { UK_POSTCODE_REGEX } from "../../common/uk-postcode";

/**
 * One card to be printed and posted. `occasionId` must reference an
 * approved occasion belonging to the caller's account — see
 * BatchOrdersService.create for the validation and the atomic
 * approved -> queued transition.
 */
export class CreateBatchOrderLineDto {
  @ApiProperty()
  @IsUUID()
  occasionId!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  shippingAddressLine1!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  shippingAddressLine2?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  shippingAddressCity!: string;

  @ApiProperty()
  @Matches(UK_POSTCODE_REGEX, { message: "shippingAddressPostcode must be a valid UK postcode" })
  shippingAddressPostcode!: string;

  @ApiProperty({ enum: DispatchOption })
  @IsEnum(DispatchOption)
  dispatchOption!: DispatchOption;

  @ApiProperty({ enum: PostageClass })
  @IsEnum(PostageClass)
  postageClass!: PostageClass;
}

export class CreateBatchOrderDto {
  @ApiProperty({ type: [CreateBatchOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateBatchOrderLineDto)
  lines!: CreateBatchOrderLineDto[];
}
