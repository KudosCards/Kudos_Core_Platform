import { PageHeaderSkeleton, Skeleton, TableSkeleton } from "@/components/skeleton";

/** Order detail: header + summary card + line-item table. */
export default function OrderDetailLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <TableSkeleton rows={5} />
    </div>
  );
}
