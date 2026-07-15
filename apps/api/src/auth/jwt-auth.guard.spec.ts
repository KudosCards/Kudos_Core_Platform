import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import jwt from "jsonwebtoken";
import { JwtAuthGuard } from "./jwt-auth.guard";
import type { EnvConfig } from "../config/env.schema";

const SECRET = "test-secret";
const USER_ID = "11111111-1111-1111-1111-111111111111";

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

function sign(payload: Record<string, unknown>, secret = SECRET): string {
  return jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: "1h" });
}

describe("JwtAuthGuard", () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    const config = {
      get: () => SECRET,
    } as unknown as ConfigService<EnvConfig, true>;
    guard = new JwtAuthGuard(reflector, config);
  });

  it("accepts a validly signed token and attaches the user to the request", () => {
    const token = sign({ sub: USER_ID, email: "andrew@example.com", aud: "authenticated" });
    const { context, getRequest } = buildContext(`Bearer ${token}`);

    expect(guard.canActivate(context)).toBe(true);
    expect(getRequest().authUser).toEqual({ id: USER_ID, email: "andrew@example.com" });
  });

  it("rejects a missing Authorization header", () => {
    const { context } = buildContext();
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("rejects a header that isn't a Bearer token", () => {
    const { context } = buildContext("Basic abc123");
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = sign({ sub: USER_ID, aud: "authenticated" }, "wrong-secret");
    const { context } = buildContext(`Bearer ${token}`);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("rejects an expired token", () => {
    const token = jwt.sign({ sub: USER_ID, aud: "authenticated" }, SECRET, {
      algorithm: "HS256",
      expiresIn: -10,
    });
    const { context } = buildContext(`Bearer ${token}`);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("rejects an unexpected audience claim", () => {
    const token = sign({ sub: USER_ID, aud: "some-other-audience" });
    const { context } = buildContext(`Bearer ${token}`);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("rejects a token missing the sub claim", () => {
    const token = sign({ email: "andrew@example.com", aud: "authenticated" });
    const { context } = buildContext(`Bearer ${token}`);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("allows a route marked @Public() through without a token", () => {
    reflector = new Reflector();
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    const config = { get: () => SECRET } as unknown as ConfigService<EnvConfig, true>;
    guard = new JwtAuthGuard(reflector, config);

    const { context } = buildContext();
    expect(guard.canActivate(context)).toBe(true);
  });
});
