/**
 * Occasion scheduling constants shared by manual creation
 * (occasions.service.ts) and the birthday auto-scheduler
 * (occasion-scheduler.service.ts) — see docs/adr/0006-phase-2-scope.md for why
 * the defaults are hardcoded rather than env vars or account settings.
 *
 * The dispatch-date maths (working days, bank holidays, seasonal lead) lives in
 * `@kudos/shared-types` so the API and the web compute it identically — see
 * docs/adr/0056-working-day-dispatch.md. Re-exported here so the existing
 * call sites keep their import path.
 */
export {
  DEFAULT_POSTAGE_LEAD_DAYS,
  POSTAGE_LEAD_DAYS,
  computeDispatchDate,
} from "@kudos/shared-types";

/** How many days ahead of dispatch a birthday occasion is created. */
export const BIRTHDAY_LOOKAHEAD_DAYS = 21;
