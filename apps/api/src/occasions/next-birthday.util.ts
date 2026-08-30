/**
 * The birthday-recurrence rule now lives in `@kudos/shared-types` so the API
 * and the web compute it identically — the Contacts list used to derive its own
 * answer and got 1 March for a 29 February birthday the API had scheduled for
 * 28 February. Re-exported here so the existing call sites keep their import
 * path, mirroring how `occasion-scheduling.constants.ts` re-exports the dispatch
 * maths. See ADR 0204.
 */
export { nextBirthdayOccurrence } from "@kudos/shared-types";
