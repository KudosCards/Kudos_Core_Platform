import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AccountType } from "@prisma/client";
import { IsEnum, IsOptional, IsString, Length } from "class-validator";

export class CreateAccountDto {
  @ApiProperty({ enum: AccountType })
  @IsEnum(AccountType)
  type!: AccountType;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  name!: string;

  /** Individuals only: the person's given name, captured explicitly so we sync
   * an exact FIRSTNAME/LASTNAME to Brevo rather than best-effort splitting
   * `name` (which mis-handles surnames with spaces). Optional — omitted for
   * organisations and tolerated for older clients. See ADR 0152. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;
}
