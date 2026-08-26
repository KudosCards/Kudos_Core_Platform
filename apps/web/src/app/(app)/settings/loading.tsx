import { PageHeaderSkeleton, Skeleton } from "@/components/skeleton";

/** Settings: header + a couple of settings cards. */
export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-4 rounded-lg border border-black/10 p-6">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-40" />
        </div>
      ))}
    </div>
  );
}
