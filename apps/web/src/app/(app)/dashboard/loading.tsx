import { Skeleton } from "@/components/skeleton";

/** Matches the dashboard's greeting + 6-tile stat grid + CTA card. */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-black/10 p-5 dark:border-white/10"
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-5 dark:border-white/10">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
    </div>
  );
}
