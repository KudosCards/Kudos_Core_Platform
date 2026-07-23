import { customAlphabet } from "nanoid";

// A team invite's token — travels in the emailed invite link, so it's URL-safe
// and long enough to be unguessable (it's the sole credential that lets someone
// join an account). Mirrors the guest claim token. See docs/adr/0028.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const TOKEN_LENGTH = 40;

export const generateInviteToken = customAlphabet(ALPHABET, TOKEN_LENGTH);

/** How long a team invite stays valid before it must be re-sent. */
export const INVITE_TTL_DAYS = 14;
