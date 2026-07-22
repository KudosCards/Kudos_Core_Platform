import { customAlphabet } from "nanoid";

// A guest account's claim token — travels in the emailed claim link, so it's
// URL-safe and long enough to be unguessable (it's the sole credential that
// lets someone attach a login to an unclaimed account). See docs/adr/0025.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const TOKEN_LENGTH = 40;

export const generateClaimToken = customAlphabet(ALPHABET, TOKEN_LENGTH);

/** How long a guest's claim link stays valid. Long enough to survive a delayed
 * "I'll sign up later", short enough that a leaked link doesn't linger forever. */
export const CLAIM_TOKEN_TTL_DAYS = 30;
