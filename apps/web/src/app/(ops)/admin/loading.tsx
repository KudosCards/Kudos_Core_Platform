import { PageHeaderSkeleton, Skeleton } from "@/components/skeleton";

/** Matches the dashboard: a header + a grid of KPI stat cards. */
export default function AdminDashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-xl border border-black/10 p-5 dark:border-white/10">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
