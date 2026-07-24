import { IsEmail, IsIn } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export const PLATFORM_ADMIN_ROLES = ["super_admin", "ops"] as const;

export class InviteAdminDto {
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: PLATFORM_ADMIN_ROLES })
  @IsIn(PLATFORM_ADMIN_ROLES)
  role!: (typeof PLATFORM_ADMIN_ROLES)[number];
}

export class SetAdminRoleDto {
  @ApiProperty({ enum: PLATFORM_ADMIN_ROLES })
  @IsIn(PLATFORM_ADMIN_ROLES)
  role!: (typeof PLATFORM_ADMIN_ROLES)[number];
}

export class ResendAdminInviteDto {
  @IsEmail()
  email!: string;
}
