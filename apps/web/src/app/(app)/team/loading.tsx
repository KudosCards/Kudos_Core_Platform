import { PageHeaderSkeleton, Skeleton, TableSkeleton } from "@/components/skeleton";

/** Team: header + seat meter + member table. */
export default function TeamLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <div className="rounded-lg border border-black/10 p-6 dark:border-white/10">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-3 w-full" />
      </div>
      <TableSkeleton rows={4} />
    </div>
  );
}
