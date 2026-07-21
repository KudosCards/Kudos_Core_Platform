import { env } from "./env";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Authenticated fetch against the Kudos API. Throws ApiError on non-2xx
 * responses. Deliberately has no server-only imports (e.g. next/headers) so
 * it's safe to import from Client Components — see api.server.ts for the
 * Server Component convenience wrapper that resolves the session for you.
 */
export async function apiFetch<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new ApiError(extractErrorMessage(body, path, response.status), response.status, body);
  }

  // 204 No Content (and any empty body) has nothing to parse — calling .json()
  // on it throws. DELETE endpoints return 204, so callers of those get undefined.
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Nest's default exception filter returns `{ message, error, statusCode }`,
 * where `message` is a plain string for most exceptions (Conflict, Forbidden,
 * NotFound, ...) but an array of strings for ValidationPipe failures (one per
 * invalid field). Previously every caller only ever saw a generic
 * "API request to X failed with 403" — the real, actionable reason (e.g.
 * "This plan allows up to 5 cards per batch order") was sitting in the
 * response body but nothing read it.
 */
function extractErrorMessage(body: unknown, path: string, status: number): string {
  const fallback = `API request to ${path} failed with ${status}`;
  if (!body || typeof body !== "object" || !("message" in body)) {
    return fallback;
  }
  const { message } = body as { message: unknown };
  if (typeof message === "string" && message.length > 0) {
    return message;
  }
  if (Array.isArray(message) && message.every((m) => typeof m === "string") && message.length > 0) {
    return message.join(", ");
  }
  return fallback;
}
