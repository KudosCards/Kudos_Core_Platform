import { IsString, Length } from "class-validator";

/** A subscriber's reply on their own ticket. */
export class SupportReplyDto {
  @IsString()
  @Length(1, 5000)
  body!: string;
}
