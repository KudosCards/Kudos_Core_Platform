import { PageHeaderSkeleton, Skeleton } from "@/components/skeleton";

/** Matches the calendar header/controls + a 5-week month grid. */
export default function CalendarLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <PageHeaderSkeleton subtitle={false} />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5">
        {Array.from({ length: 35 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-none" />
        ))}
      </div>
    </div>
  );
}
