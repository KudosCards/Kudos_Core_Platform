import jwt from "jsonwebtoken";

/** Mints a Supabase-shaped JWT signed with the same secret the test app boots with. */
export function mintToken(secret: string, userId: string, email = "test@example.com"): string {
  return jwt.sign({ sub: userId, email, aud: "authenticated" }, secret, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
}
