import { PageHeaderSkeleton, Skeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <TableSkeleton rows={5} />
    </div>
  );
}
