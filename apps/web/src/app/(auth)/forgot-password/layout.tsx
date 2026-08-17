import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/site";

/**
 * Metadata holder for the client-component page — see login/layout.tsx.
 * Noindex: a password-reset step is a transactional dead end, not a landing
 * page, and it's reached from a link rather than from search.
 */
export const metadata: Metadata = {
  title: "Reset your password",
  ...NO_INDEX,
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
