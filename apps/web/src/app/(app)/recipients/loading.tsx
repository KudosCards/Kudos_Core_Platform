import { PageHeaderSkeleton, Skeleton } from "@/components/skeleton";

/** Matches the recipients header + add/import cards + table. */
export default function RecipientsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton subtitle={false} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-lg border border-black/10 p-6 dark:border-white/10">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="flex flex-col gap-4 rounded-lg border border-black/10 p-6 dark:border-white/10">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
