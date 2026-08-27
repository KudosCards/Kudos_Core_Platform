"use client";

import { ApiError, apiFetch } from "./api";
import { env } from "./env";
import { createClient } from "./supabase/client";

async function requireAccessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // The middleware only guards navigation, not calls made from an
    // already-mounted Client Component — a session that expires while the
    // user is active on a page needs to be handled here too, or every
    // caller's catch block was showing a permanent, misleading generic
    // error instead of ever getting the user back to a working state.
    window.location.assign("/login");
    throw new Error("Session expired — redirecting to login");
  }
  return session.access_token;
}

/** Client Component convenience wrapper: resolves the browser session and calls apiFetch. */
export async function clientApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(path, await requireAccessToken(), init);
}

/**
 * Fetch a binary response from the API (e.g. a generated PDF) and save it to the
 * user's device. Same auth as `clientApiFetch`, but reads the body as a blob and
 * triggers a download, honouring the server's `Content-Disposition` filename.
 */
export async function clientApiDownload(
  path: string,
  init: RequestInit,
  fallbackFilename: string,
): Promise<void> {
  const accessToken = await requireAccessToken();
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
    const message =
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Download failed with ${response.status}`;
    throw new ApiError(message, response.status, body);
  }

  const blob = await response.blob();
  const filename =
    filenameFromDisposition(response.headers.get("content-disposition")) ?? fallbackFilename;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Pull a filename out of a `Content-Disposition` header, if present. */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1]!) : null;
}
