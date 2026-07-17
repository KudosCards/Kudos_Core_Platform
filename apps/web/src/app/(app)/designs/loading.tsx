import { PageHeaderSkeleton, Skeleton } from "@/components/skeleton";

/** Matches the designs gallery: header + a responsive grid of card tiles. */
export default function DesignsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-black/10 p-3 dark:border-white/10"
          >
            <Skeleton className="aspect-[7/5] w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
