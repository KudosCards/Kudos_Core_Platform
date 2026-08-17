import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/site";

/**
 * Metadata holder for the client-component page — see login/layout.tsx.
 * Noindex: reached from a Supabase email link with the session in the URL
 * fragment; there's nothing here for a search result to point at.
 */
export const metadata: Metadata = {
  title: "Choose a new password",
  ...NO_INDEX,
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
