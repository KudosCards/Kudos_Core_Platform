import { customAlphabet } from "nanoid";

// Excludes visually ambiguous characters (0/O, 1/I/l) since this ends up on a
// printed QR code with a human-typeable fallback — see messagePageSchema's
// slug: z.string().min(6) in @kudos/shared-types.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const SLUG_LENGTH = 10;

export const generateSlug = customAlphabet(ALPHABET, SLUG_LENGTH);
