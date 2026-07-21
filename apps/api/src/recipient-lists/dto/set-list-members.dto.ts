import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from "class-validator";

export class AddListMembersDto {
  @ApiProperty({ type: [String], description: "Recipient ids to add to the list" })
  @IsArray()
  @ArrayMinSize(1)
  // Bounded so one request can't try to attach an unbounded id list; well above
  // any plan's recipient cap, so no legitimate "add everyone" call hits it.
  @ArrayMaxSize(1000)
  @IsUUID("4", { each: true })
  recipientIds!: string[];
}
