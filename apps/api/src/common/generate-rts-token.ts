import { customAlphabet } from "nanoid";

// The secret token in the Returned-to-Sender email link. It's the sole
// credential that lets someone update the address and recover the card without
// logging in, so it's URL-safe and long enough to be unguessable — same shape
// as the invite / guest-claim tokens. See docs/adr/0039-returned-to-sender.md.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const TOKEN_LENGTH = 40;

export const generateRtsToken = customAlphabet(ALPHABET, TOKEN_LENGTH);
