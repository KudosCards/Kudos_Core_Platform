import { TableSkeleton } from "@/components/skeleton";

/** Generic ops-page silhouette (fulfillment queue, catalog, admin lists) so a
 * navigation paints instantly instead of freezing on the previous page. */
export default function OpsLoading() {
  return <TableSkeleton />;
}
