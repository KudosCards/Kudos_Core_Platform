import type { SVGProps } from "react";

/**
 * Kudos Cards' public social channels — the single source of truth for these
 * URLs across the site (marketing footer, in-app tutorials link, …). Clean
 * canonical URLs, no tracking parameters.
 */
export const SOCIAL_LINKS = {
  linkedin: "https://www.linkedin.com/company/kudos-cards",
  instagram: "https://www.instagram.com/kudos_cards",
  youtube: "https://youtube.com/@kudoscardsuk",
} as const;

type IconProps = SVGProps<SVGSVGElement>;

function LinkedInIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
    </svg>
  );
}

function InstagramIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

function YouTubeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

const CHANNELS = [
  { key: "linkedin", href: SOCIAL_LINKS.linkedin, label: "LinkedIn", Icon: LinkedInIcon },
  { key: "instagram", href: SOCIAL_LINKS.instagram, label: "Instagram", Icon: InstagramIcon },
  { key: "youtube", href: SOCIAL_LINKS.youtube, label: "YouTube", Icon: YouTubeIcon },
] as const;

/**
 * A row of icon links to the Kudos Cards social channels. External links open in
 * a new tab with `rel="noopener noreferrer"`. `iconClassName` sizes the icons so
 * the same component fits both a marketing footer and a compact in-app spot.
 */
export function SocialLinks({
  className,
  iconClassName = "size-5",
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div className={`flex items-center gap-4 ${className ?? ""}`}>
      {CHANNELS.map(({ key, href, label, Icon }) => (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Kudos Cards on ${label}`}
          title={`Kudos Cards on ${label}`}
          className="text-current transition-opacity hover:opacity-70"
        >
          <Icon className={iconClassName} />
        </a>
      ))}
    </div>
  );
}

/**
 * A labelled link to the Kudos Cards YouTube channel — our tutorials live there.
 * Used inside the app where members are working and might want a how-to.
 */
export function TutorialsLink({
  className,
  onClick,
}: {
  className?: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={SOCIAL_LINKS.youtube}
      target="_blank"
      rel="noopener noreferrer"
      title="Watch Kudos Cards tutorials on YouTube"
      className={className}
      onClick={onClick}
    >
      <YouTubeIcon className="size-4 shrink-0" />
      <span>Watch tutorials</span>
      <span aria-hidden>↗</span>
    </a>
  );
}
