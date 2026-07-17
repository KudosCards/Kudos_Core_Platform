import { PageHeaderSkeleton, Skeleton } from "@/components/skeleton";

/** Matches the orders header + the divided list of order rows. */
export default function OrdersLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <div className="flex flex-col divide-y divide-black/5 rounded-lg border border-black/10 dark:divide-white/5 dark:border-white/10">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
