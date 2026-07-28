import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from "class-validator";

/** Attach more contacts to a shared event's cohort. */
export class AddEventMembersDto {
  @ApiProperty({ type: [String], description: "Contacts to attach to the event" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID("4", { each: true })
  recipientIds!: string[];
}
