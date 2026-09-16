import { IsIn } from "class-validator";

const STATUSES = ["new", "in_progress", "closed", "spam"] as const;

/** Ops moves a lead through triage. Status is the only mutable field. `spam` is
 * included both ways: ops bin one the gate missed, and restore one it shouldn't
 * have caught (back to `new`). See ADR 0244. */
export class UpdateEnterpriseEnquiryDto {
  @IsIn(STATUSES)
  status!: (typeof STATUSES)[number];
}
