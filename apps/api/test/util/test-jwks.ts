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

export async function mintToken(userId: string, email = "test@example.com"): Promise<string> {
  const { privateKey } = await getKeys();
  return new SignJWT({ sub: userId, email, aud: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}
