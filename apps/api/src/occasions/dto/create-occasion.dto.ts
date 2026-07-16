import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionType } from "@prisma/client";
import { IsDateString, IsEnum, IsOptional, IsUUID } from "class-validator";

/**
 * Always creates a source="one_off_campaign" occasion — recurring birthday
 * occasions only ever come from the scheduler (occasion-scheduler.service.ts).
 * See docs/adr/0006-phase-2-scope.md.
 */
export class CreateOccasionDto {
  @ApiPropertyOptional({ description: "Omit for an org-wide campaign with no single recipient" })
  @IsOptional()
  @IsUUID()
  recipientId?: string;

  @ApiProperty({ enum: OccasionType })
  @IsEnum(OccasionType)
  type!: OccasionType;

  @ApiProperty({ description: "ISO date, e.g. 2026-08-01" })
  @IsDateString()
  occasionDate!: string;
}
