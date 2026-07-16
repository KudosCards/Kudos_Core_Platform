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
    throw new ApiError(
      `API request to ${path} failed with ${response.status}`,
      response.status,
      body,
    );
  }

  return response.json() as Promise<T>;
}
