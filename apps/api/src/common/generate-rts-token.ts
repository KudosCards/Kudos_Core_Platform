import { customAlphabet } from "nanoid";

// The secret token in the Returned-to-Sender email link. It's the sole
// credential that lets someone update the address and recover the card without
// logging in, so it's URL-safe and long enough to be unguessable — same shape
// as the invite / guest-claim tokens. See docs/adr/0039-returned-to-sender.md.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const TOKEN_LENGTH = 40;

export const generateRtsToken = customAlphabet(ALPHABET, TOKEN_LENGTH);

/**
 * How long an RTS recovery link stays usable, in days.
 *
 * The two sibling bearer tokens in this codebase are both bounded — invites at
 * 14 days, guest claims at 30 — and this one was not bounded at all. 30 matches
 * the guest claim, which is the closer analogue: both are sent to a customer who
 * may take a while to notice the email, and both hand over something that
 * matters. See ADR 0189.
 */
export const RTS_TOKEN_TTL_DAYS = 30;

/** When a token minted now stops working. */
export function rtsTokenExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + RTS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
