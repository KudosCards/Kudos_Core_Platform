import type { Metadata } from "next";

/**
 * The login page itself is a client component, so it can't export `metadata` —
 * this one-child layout carries it instead. Cheaper and far lower risk than
 * splitting the auth form into a server wrapper + client child.
 */
export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to your Kudos Cards account.",
  alternates: { canonical: "/login" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
