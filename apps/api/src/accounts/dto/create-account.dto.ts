import { ApiProperty } from "@nestjs/swagger";
import { AccountType } from "@prisma/client";
import { IsEnum, IsString, Length } from "class-validator";

export class CreateAccountDto {
  @ApiProperty({ enum: AccountType })
  @IsEnum(AccountType)
  type!: AccountType;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  name!: string;
}
