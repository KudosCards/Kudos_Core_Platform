import Image from "next/image";

/**
 * The Kudos Cards wordmark/logo. Height-constrained (`w-auto` on a fixed height,
 * e.g. `h-10`) so it scales cleanly in headers, the sidebar and the auth shell.
 * The single source for the brand mark across the app — marketing and the public
 * card library have their own inline copies for their bespoke looks.
 */
export function Logo({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/marketing/logo.png"
      alt="Kudos Cards"
      width={410}
      height={475}
      className={className}
      priority={priority}
    />
  );
}
