import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";
import { JwtAuthGuard } from "./jwt-auth.guard";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const KEY_ID = "test-key-1";

function buildContext(authorizationHeader?: string): {
  context: ExecutionContext;
  getRequest: () => { authUser?: unknown; headers: Record<string, string> };
} {
  const request: { authUser?: unknown; headers: Record<string, string> } = {
    headers: authorizationHeader ? { authorization: authorizationHeader } : {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (): void => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  return { context, getRequest: () => request };
}

describe("JwtAuthGuard", () => {
  let privateKey: KeyLike;
  let jwks: JWTVerifyGetKey;
  let wrongKeyJwks: JWTVerifyGetKey;

  beforeAll(async () => {
    // A real ES256 keypair, matching how Supabase actually signs tokens —
    // verified against a local JWKS built from the public half, exactly
    // like createRemoteJWKSet does for the real endpoint, just without the
    // network call.
    const { privateKey: priv, publicKey } = await generateKeyPair("ES256");
    privateKey = priv;
    const publicJwk = await exportJWK(publicKey);
    jwks = createLocalJWKSet({ keys: [{ ...publicJwk, kid: KEY_ID, alg: "ES256" }] });

    const { publicKey: otherPublicKey } = await generateKeyPair("ES256");
    const otherJwk = await exportJWK(otherPublicKey);
    wrongKeyJwks = createLocalJWKSet({ keys: [{ ...otherJwk, kid: KEY_ID, alg: "ES256" }] });
  });

  function sign(
    payload: Record<string, unknown>,
    options: { expiresIn?: string; key?: KeyLike } = {},
  ): Promise<string> {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "1h")
      .sign(options.key ?? privateKey);
  }

  function buildGuard(resolver: JWTVerifyGetKey = jwks): JwtAuthGuard {
    return new JwtAuthGuard(new Reflector(), resolver);
  }

  it("accepts a validly signed token and attaches the user to the request", async () => {
    const token = await sign({ sub: USER_ID, email: "andrew@example.com", aud: "authenticated" });
    const { context, getRequest } = buildContext(`Bearer ${token}`);

    await expect(buildGuard().canActivate(context)).resolves.toBe(true);
    expect(getRequest().authUser).toEqual({ id: USER_ID, email: "andrew@example.com" });
  });

  it("rejects a missing Authorization header", async () => {
    const { context } = buildContext();
    await expect(buildGuard().canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a header that isn't a Bearer token", async () => {
    const { context } = buildContext("Basic abc123");
    await expect(buildGuard().canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a token signed with a key not in the JWKS", async () => {
    const token = await sign({ sub: USER_ID, aud: "authenticated" });
    const { context } = buildContext(`Bearer ${token}`);
    await expect(buildGuard(wrongKeyJwks).canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects an expired token", async () => {
    const token = await sign({ sub: USER_ID, aud: "authenticated" }, { expiresIn: "-10s" });
    const { context } = buildContext(`Bearer ${token}`);
    await expect(buildGuard().canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects an unexpected audience claim", async () => {
    const token = await sign({ sub: USER_ID, aud: "some-other-audience" });
    const { context } = buildContext(`Bearer ${token}`);
    await expect(buildGuard().canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a token with no audience claim at all", async () => {
    const token = await sign({ sub: USER_ID });
    const { context } = buildContext(`Bearer ${token}`);
    await expect(buildGuard().canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a token missing the sub claim", async () => {
    const token = await sign({ email: "andrew@example.com", aud: "authenticated" });
    const { context } = buildContext(`Bearer ${token}`);
    await expect(buildGuard().canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("allows a route marked @Public() through without a token", async () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    const guard = new JwtAuthGuard(reflector, jwks);

    const { context } = buildContext();
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
