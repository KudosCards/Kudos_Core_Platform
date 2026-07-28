import { IsBoolean, IsOptional, IsString, Length } from "class-validator";

/** An operator's reply. An internal note is support-only — never shown to, or
 * notified to, the customer, and it doesn't change whose turn it is. */
export class SupportOpsReplyDto {
  @IsString()
  @Length(1, 5000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  internalNote?: boolean;
}
