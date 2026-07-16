import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class ApproveOccasionDto {
  @ApiProperty()
  @IsUUID()
  savedDesignId!: string;
}
