import { PageHeaderSkeleton, Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeaderSkeleton />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full" />
      ))}
    </div>
  );
}
