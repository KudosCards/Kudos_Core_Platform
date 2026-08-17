import type { Metadata } from "next";

/** Metadata holder for the client-component register page — see login/layout.tsx. */
export const metadata: Metadata = {
  title: "Create your free account",
  description:
    "Start for free, no card needed. Add your contacts, pick a design, and we print and post real cards for you.",
  alternates: { canonical: "/register" },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
