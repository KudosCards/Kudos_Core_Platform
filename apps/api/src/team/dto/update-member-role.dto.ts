import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: ["admin", "staff"] })
  @IsIn(["admin", "staff"])
  role!: "admin" | "staff";
}
