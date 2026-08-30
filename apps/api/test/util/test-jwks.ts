import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";

const KEY_ID = "test-key-1";

let cached: { privateKey: KeyLike; jwks: JWTVerifyGetKey } | null = null;

/**
 * A real ES256 keypair generated once per test run, matching how Supabase
 * actually signs session tokens. mintToken() and getTestJwks() share the
 * same keypair, so a locally-minted test token verifies exactly the way a
 * real Supabase-issued token would against the real JWKS endpoint — no
 * network call, no shared secret.
 */
async function getKeys(): Promise<{ privateKey: KeyLike; jwks: JWTVerifyGetKey }> {
  if (!cached) {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    cached = {
      privateKey,
      jwks: createLocalJWKSet({ keys: [{ ...publicJwk, kid: KEY_ID, alg: "ES256" }] }),
    };
  }
  return cached;
}

export async function getTestJwks(): Promise<JWTVerifyGetKey> {
  return (await getKeys()).jwks;
}

/**
 * Mint a signed test JWT. Pass `email: null` to omit the `email` claim entirely
 * — mirrors a Supabase session whose token carries no email.
 *
 * `emailVerified` defaults to true because that is what a real Supabase session
 * for a confirmed user looks like: GoTrue mirrors the confirmation into
 * `user_metadata.email_verified`. Pass false to mint the token an unconfirmed
 * address would get, which is what the guards in ADR 0188 refuse.
 */
export async function mintToken(
  userId: string,
  email: string | null = "test@example.com",
  emailVerified = true,
): Promise<string> {
  const { privateKey } = await getKeys();
  return new SignJWT({
    sub: userId,
    aud: "authenticated",
    ...(email ? { email } : {}),
    user_metadata: { email_verified: emailVerified },
  })
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}
