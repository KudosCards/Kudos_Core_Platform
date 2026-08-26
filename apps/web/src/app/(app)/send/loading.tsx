import { PageHeaderSkeleton, Skeleton } from "@/components/skeleton";

/** Bulk-send: header + design/recipient pickers. Shown instantly on navigation
 * while the server fetches designs, lists and recipients. */
export default function SendLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-4 rounded-lg border border-black/10 p-6">
            <Skeleton className="h-5 w-40" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, j) => (
                <Skeleton key={j} className="aspect-[7/5] w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
