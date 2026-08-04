import Link from "next/link";
import { notFound } from "next/navigation";
import type { AdminOrderDetail, FulfillmentJobStatus } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { ORDER_STATUS_CLASSES, ORDER_STATUS_LABELS, formatGbp, formatOrderDate } from "@/lib/orders";
import { formatOrderNumber } from "@/lib/admin";
import { OCCASION_TYPE_LABELS } from "@/lib/occasions";

const JOB_STATUS_LABELS: Record<FulfillmentJobStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  printed: "Printed",
  posted: "Posted",
  delivered: "Delivered",
  returned_to_sender: "Returned",
  failed: "Failed",
};

const JOB_STATUS_CLASSES: Record<FulfillmentJobStatus, string> = {
  pending: "bg-foreground/[0.07] text-muted",
  in_progress: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  printed: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
  posted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  delivered: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  returned_to_sender: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

const POSTAGE_LABELS: Record<string, string> = {
  first_class: "1st class",
  second_class: "2nd class",
};

/** The active job statuses whose deadline still matters (an overdue posted card
 * isn't overdue any more). */
const OPEN_STATUSES: FulfillmentJobStatus[] = ["pending", "in_progress", "printed"];

function formatDueDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Whether an open card's posting deadline has already passed. Display-only
 * calendar compare — the working-day badge lives in the dispatch queue. */
function isOverdue(dueDate: string | Date, status: FulfillmentJobStatus | null): boolean {
  if (!status || !OPEN_STATUSES.includes(status)) return false;
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function ProgressBreakdown({ progress }: { progress: AdminOrderDetail["progress"] }) {
  if (progress.total === 0) {
    return (
      <p className="text-sm text-muted">
        This order isn&apos;t in fulfilment yet — cards enter the queue once it&apos;s paid.
      </p>
    );
  }
  const done = progress.posted + progress.delivered;
  const pct = Math.round((done / progress.total) * 100);
  const cells: { label: string; value: number }[] = [
    { label: "Pending", value: progress.pending },
    { label: "In progress", value: progress.inProgress },
    { label: "Printed", value: progress.printed },
    { label: "Posted", value: progress.posted },
    { label: "Delivered", value: progress.delivered },
    { label: "Returned", value: progress.returnedToSender },
    { label: "Failed", value: progress.failed },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium tabular-nums">
          {done.toLocaleString("en-GB")} / {progress.total.toLocaleString("en-GB")} posted
        </span>
        <span className="text-muted tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells
          .filter((c) => c.value > 0)
          .map((c) => (
            <div key={c.label} className="rounded-lg border border-border px-3 py-2">
              <p className="text-lg font-semibold tabular-nums">{c.value.toLocaleString("en-GB")}</p>
              <p className="text-xs text-muted">{c.label}</p>
            </div>
          ))}
      </div>
      {(progress.imported > 0 || progress.importErrors > 0) && (
        <p className="text-xs text-muted">
          Click &amp; Drop: {progress.imported.toLocaleString("en-GB")} imported
          {progress.importErrors > 0 && (
            <span className="text-amber-700 dark:text-amber-400">
              {" "}
              · {progress.importErrors.toLocaleString("en-GB")} import error
              {progress.importErrors === 1 ? "" : "s"}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await serverApiFetch<AdminOrderDetail>(`/admin/orders/${id}`);
  if (!order) {
    notFound();
  }

  const openCards = order.progress.pending + order.progress.inProgress + order.progress.printed;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/admin/orders" className="text-sm text-muted hover:text-accent">
          ← All orders
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">
            {formatOrderNumber(order.orderNumber)}
          </h1>
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${ORDER_STATUS_CLASSES[order.status]}`}
          >
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        </div>
        <p className="text-sm text-muted">
          <Link href={`/admin/subscribers/${order.accountId}`} className="hover:text-accent">
            {order.accountName}
          </Link>{" "}
          · {order.cardCount.toLocaleString("en-GB")} card
          {order.cardCount === 1 ? "" : "s"} · placed {formatOrderDate(order.createdAt)}
          {order.paymentMethod && <> · {order.paymentMethod === "wallet" ? "Wallet" : "Card"}</>}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* Progress spans two columns on ≥sm; money sits alongside. */}
        <section className="rounded-xl border border-border p-5 sm:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
              Fulfilment progress
            </h2>
            {openCards > 0 && (
              <Link
                href="/fulfillment?status=pending"
                className="text-xs font-medium text-accent hover:underline"
              >
                Work in dispatch queue →
              </Link>
            )}
          </div>
          <ProgressBreakdown progress={order.progress} />
        </section>

        <section className="rounded-xl border border-border p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Payment</h2>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Subtotal</dt>
              <dd className="tabular-nums">{formatGbp(order.subtotalMinor)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Postage</dt>
              <dd className="tabular-nums">{formatGbp(order.postageMinor)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 font-semibold">
              <dt>Total (inc. VAT)</dt>
              <dd className="tabular-nums">{formatGbp(order.totalMinor)}</dd>
            </div>
          </dl>
          {order.receiptUrl && (
            <a
              href={order.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-xs font-medium text-accent hover:underline"
            >
              View VAT receipt →
            </a>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
          Cards ({order.lines.length.toLocaleString("en-GB")})
        </h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
                <th className="px-5 py-3 font-medium">Recipient</th>
                <th className="px-5 py-3 font-medium">Occasion</th>
                <th className="px-5 py-3 font-medium">Design</th>
                <th className="px-5 py-3 font-medium">Postage</th>
                <th className="px-5 py-3 font-medium">Due</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Tracking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.lines.map((line) => {
                const overdue = line.dueDate ? isOverdue(line.dueDate, line.jobStatus) : false;
                return (
                  <tr key={line.orderRecipientId} className="hover:bg-foreground/[0.02]">
                    <td className="px-5 py-3 font-medium">{line.recipientName}</td>
                    <td className="px-5 py-3 text-muted">
                      {line.occasionType
                        ? (OCCASION_TYPE_LABELS[line.occasionType] ?? line.occasionType)
                        : "—"}
                    </td>
                    <td className="px-5 py-3 text-muted">{line.designName}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-muted">
                      {POSTAGE_LABELS[line.postageClass] ?? line.postageClass}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {line.dueDate ? (
                        <span className={overdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted"}>
                          {formatDueDate(line.dueDate)}
                          {overdue && " · overdue"}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {line.jobStatus ? (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${JOB_STATUS_CLASSES[line.jobStatus]}`}
                        >
                          {JOB_STATUS_LABELS[line.jobStatus]}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">Not queued</span>
                      )}
                      {line.clickAndDropError && (
                        <span
                          title={line.clickAndDropError}
                          className="ml-1 text-xs text-amber-700 dark:text-amber-400"
                        >
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted tabular-nums">
                      {line.trackingReference ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
