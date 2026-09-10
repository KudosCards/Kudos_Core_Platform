import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  CAMPAIGN_MAX_AMOUNT_MINOR,
  CAMPAIGN_MAX_BUDGET_MINOR,
  CAMPAIGN_MIN_AMOUNT_MINOR,
  CAMPAIGN_MIN_BUDGET_MINOR,
} from "@kudos/shared-types";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

/** A YYYY-MM-DD London calendar day, as an operator types it. */
const LONDON_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A new campaign. Created `draft`, so nothing is paid out until an operator
 * looks at what they typed and sets it live.
 */
export class CreateWalletCampaignDto {
  @ApiProperty({ description: 'What this campaign is, for the ops list. e.g. "October welcome".' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 80)
  name!: string;

  @ApiProperty({
    description: `Per-account credit in pence, ${CAMPAIGN_MIN_AMOUNT_MINOR}-${CAMPAIGN_MAX_AMOUNT_MINOR}.`,
  })
  @IsInt()
  @Min(CAMPAIGN_MIN_AMOUNT_MINOR)
  @Max(CAMPAIGN_MAX_AMOUNT_MINOR)
  amountMinor!: number;

  @ApiProperty({
    description:
      "First London day of the window, inclusive (YYYY-MM-DD). London, not UTC: a window " +
      "stored in UTC would exclude someone who signed up at 00:30 BST on the first.",
  })
  @Matches(LONDON_DAY, { message: "startsOn must be a London date as YYYY-MM-DD" })
  startsOn!: string;

  @ApiProperty({ description: "Last London day of the window, inclusive (YYYY-MM-DD)." })
  @Matches(LONDON_DAY, { message: "endsOn must be a London date as YYYY-MM-DD" })
  endsOn!: string;

  @ApiProperty({
    description: `Total the campaign may ever pay out, in pence, ${CAMPAIGN_MIN_BUDGET_MINOR}-${CAMPAIGN_MAX_BUDGET_MINOR}. Required: an amount times an unbounded number of sign-ups is unbounded liability.`,
  })
  @IsInt()
  @Min(CAMPAIGN_MIN_BUDGET_MINOR)
  @Max(CAMPAIGN_MAX_BUDGET_MINOR)
  budgetMinor!: number;
}

/**
 * An edit. What may change depends on whether anyone has been paid yet:
 *
 * - `name` and `budgetMinor` — any time before the campaign ends. A budget is a
 *   ceiling we set ourselves, not a promise made to anybody.
 * - `amountMinor`, `startsOn`, `endsOn` — **draft only**. "Sign up in October
 *   and get £5" is a promise to everyone in that window, and one credit per
 *   account means an early sign-up cannot be topped up to match a later raise.
 *   Changing the offer means ending this campaign and starting another.
 */
export class UpdateWalletCampaignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Length(3, 80)
  name?: string;

  @ApiPropertyOptional({ description: "Draft only." })
  @IsOptional()
  @IsInt()
  @Min(CAMPAIGN_MIN_AMOUNT_MINOR)
  @Max(CAMPAIGN_MAX_AMOUNT_MINOR)
  amountMinor?: number;

  @ApiPropertyOptional({ description: "Draft only." })
  @IsOptional()
  @Matches(LONDON_DAY, { message: "startsOn must be a London date as YYYY-MM-DD" })
  startsOn?: string;

  @ApiPropertyOptional({ description: "Draft only." })
  @IsOptional()
  @Matches(LONDON_DAY, { message: "endsOn must be a London date as YYYY-MM-DD" })
  endsOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(CAMPAIGN_MIN_BUDGET_MINOR)
  @Max(CAMPAIGN_MAX_BUDGET_MINOR)
  budgetMinor?: number;
}

/** The states an operator can move a campaign to by hand. `exhausted` is not
 *  among them — only spending the budget produces that. */
export class SetWalletCampaignStatusDto {
  @ApiProperty({ enum: ["live", "paused", "ended"] })
  @IsIn(["live", "paused", "ended"])
  status!: "live" | "paused" | "ended";
}
