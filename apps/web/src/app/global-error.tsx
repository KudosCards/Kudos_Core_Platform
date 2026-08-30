"use client";

import { ErrorScreen } from "@/components/error-screen";
import "./globals.css";

/**
 * The last boundary: errors thrown by the root layout itself, which a route
 * `error.tsx` cannot catch because it renders *inside* that layout.
 *
 * It therefore has to supply its own `<html>` and `<body>` — the layout that
 * would normally provide them is the thing that failed. The font variables the
 * root layout sets are gone too, so this renders in the browser's default face
 * rather than pretending otherwise. See ADR 0206.
 */
export default function GlobalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <ErrorScreen
          {...props}
          title="Something went wrong"
          message="Kudos Cards didn’t load. This is usually temporary — try again in a moment."
        />
      </body>
    </html>
  );
}
