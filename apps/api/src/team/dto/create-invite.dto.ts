import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsIn } from "class-validator";

/**
 * Invite a teammate to join the account. Only "admin" or "staff" can be
 * invited — an account has exactly one "owner", so it's never invitable.
 */
export class CreateInviteDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ["admin", "staff"] })
  @IsIn(["admin", "staff"])
  role!: "admin" | "staff";
}
