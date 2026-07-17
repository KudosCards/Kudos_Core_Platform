import { PageHeaderSkeleton, Skeleton } from "@/components/skeleton";

/**
 * Default streaming fallback for every app route without its own
 * `loading.tsx`. The sidebar layout persists across navigation, so this
 * fills only the main content area — the user sees an instant response to
 * their click while the page's data loads.
 */
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
