import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

/** Body for POST /guest/claim — the single-use token from the buyer's receipt. */
export class ClaimAccountDto {
  @ApiProperty({ description: "The claim token from the guest's success page / receipt link" })
  @IsString()
  @Length(1, 100)
  claimToken!: string;
}
