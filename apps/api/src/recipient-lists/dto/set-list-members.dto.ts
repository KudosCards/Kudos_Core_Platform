import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from "class-validator";

export class AddListMembersDto {
  @ApiProperty({ type: [String], description: "Recipient ids to add to the list" })
  @IsArray()
  @ArrayMinSize(1)
  // A payload bound, not a plan bound. The old comment claimed 1,000 was "well
  // above any plan's recipient cap" — Centre's cap is 2,000 and Enterprise has
  // none, so a Centre account selecting all its contacts and adding them to a
  // list got a 400 for doing exactly what the button offers. 5,000 clears every
  // capped plan with room; an uncapped account with more than that has to add
  // them in batches, which is a client concern rather than a reason to let one
  // request carry an unbounded list. See ADR 0207.
  @ArrayMaxSize(5000)
  @IsUUID("4", { each: true })
  recipientIds!: string[];
}
