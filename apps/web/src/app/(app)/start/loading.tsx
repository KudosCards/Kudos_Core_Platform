import { PageHeaderSkeleton, Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
