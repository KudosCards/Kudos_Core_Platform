import type { ComponentProps } from "react";

/**
 * A single shimmering placeholder block. Compose these into per-route
 * `loading.tsx` skeletons so a navigation paints an instant, layout-matched
 * silhouette (streamed while the server component fetches) instead of
 * freezing on the previous page — the difference between the app feeling
 * snappy and feeling stuck.
 */
export function Skeleton({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-black/[0.06] dark:bg-white/[0.08] ${className}`}
      {...props}
    />
  );
}

/** The title (+ optional subtitle) block most pages open with. */
export function PageHeaderSkeleton({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-8 w-52" />
      {subtitle && <Skeleton className="h-4 w-80 max-w-full" />}
    </div>
  );
}
