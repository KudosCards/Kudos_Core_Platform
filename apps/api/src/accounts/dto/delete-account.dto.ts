import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

/** Body for DELETE /accounts/me — a typed confirmation that must match the
 * account's name exactly, so an irreversible deletion can't fire by accident. */
export class DeleteAccountDto {
  @ApiProperty({ description: "The account name, typed to confirm deletion." })
  @IsString()
  @MinLength(1)
  confirmName!: string;
}
