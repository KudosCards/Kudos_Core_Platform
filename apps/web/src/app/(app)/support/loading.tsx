import { PageHeaderSkeleton, Skeleton } from "@/components/skeleton";

/** Matches the support header, the "new ticket" button, and the ticket list. */
export default function SupportLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <Skeleton className="h-10 w-40 rounded-md" />
      <div className="flex flex-col divide-y divide-black/5 rounded-lg border border-black/10">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
