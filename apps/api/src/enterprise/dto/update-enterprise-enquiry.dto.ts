import { IsIn } from "class-validator";

const STATUSES = ["new", "in_progress", "closed"] as const;

/** Ops moves a lead through triage. Status is the only mutable field. */
export class UpdateEnterpriseEnquiryDto {
  @IsIn(STATUSES)
  status!: (typeof STATUSES)[number];
}
