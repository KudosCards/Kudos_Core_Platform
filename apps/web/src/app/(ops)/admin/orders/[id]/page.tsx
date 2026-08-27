import Link from "next/link";
import { notFound } from "next/navigation";
import type { AdminIdentity, AdminOrderDetail } from "@kudos/shared-types";
import {
  describeSendSchedule,
  orderScheduleIsLive,
  summariseSendSchedule,
} from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import {
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  formatGbp,
  formatOrderDate,
} from "@/lib/orders";
import { formatOrderNumber } from "@/lib/admin";
import { OrderCockpit } from "./order-cockpit-client";

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
              <p className="text-lg font-semibold tabular-nums">
                {c.value.toLocaleString("en-GB")}
              </p>
              <p className="text-xs text-muted">{c.label}</p>
            </div>
          ))}
      </div>
      {(progress.imported > 0 || progress.importErrors > 0) && (
        <p className="text-xs text-muted">
          Click &amp; Drop: {progress.imported.toLocaleString("en-GB")} imported
          {progress.importErrors > 0 && (
            <span className="text-amber-700">
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
  const [order, shipping, clickAndDrop, me] = await Promise.all([
    serverApiFetch<AdminOrderDetail>(`/admin/orders/${id}`),
    serverApiFetch<{ enabled: boolean }>("/fulfillment/shipping-status"),
    serverApiFetch<{ enabled: boolean }>("/fulfillment/click-and-drop-status"),
    // The re-date repair is super-admin-only on the server. Fetch the viewer's
    // role so the button isn't offered to an operator who would only get a 403.
    // Non-fatal: without it the button is simply hidden.
    serverApiFetch<AdminIdentity>("/admin/me").catch(() => null),
  ]);
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
          {order.paymentMethod && (
            <>
              {" · "}
              {order.paymentMethod === "wallet"
                ? "Wallet"
                : order.walletAppliedMinor > 0
                  ? "Wallet + card"
                  : "Card"}
            </>
          )}
        </p>
        {/* The same sentence the customer reads on their own order page, from
            the same function. Ops could already see every card's post-by date
            in the table below, but on a seventy-six card order that means
            eyeballing seventy-six rows to answer "is this spread or not?" — so
            a support conversation started from a different summary of the same
            order than the customer was looking at. See ADR 0170.

            Gated by the same predicate the customer's screens use. A
            refund-cancel deletes only the *pending* fulfilment jobs, so a
            cancelled order that had already been part-printed keeps dated jobs
            behind — and without this the operator would be told a cancelled
            order was still going out. */}
        {orderScheduleIsLive(order.status) &&
          (() => {
            const copy = describeSendSchedule(
              summariseSendSchedule(
                order.lines.map((line) => ({
                  // The fulfilment-job statuses that matter here — posted,
                  // delivered, returned_to_sender — share their names with the
                  // order-recipient ones the summariser keys on. Anything
                  // earlier (pending / in_progress / printed) is correctly
                  // "still to come": printed is not posted.
                  status: line.jobStatus ?? "pending",
                  dispatchDate: line.dueDate,
                })),
              ),
              formatOrderDate,
            );
            return copy ? (
              <p className="text-sm text-muted">
                <span className="font-medium text-foreground">Scheduled — {copy.lead}</span>
                {copy.detail ? ` ${copy.detail}` : ""}
              </p>
            ) : null;
          })()}
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
            {/* Split out when the wallet paid part of it, so a support query
                about "why does my receipt say less than my order?" can be
                answered from this screen. See ADR 0169. */}
            {order.walletAppliedMinor > 0 && (
              <>
                <div className="flex justify-between">
                  <dt className="text-muted">From wallet</dt>
                  <dd className="tabular-nums">−{formatGbp(order.walletAppliedMinor)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Charged to card</dt>
                  <dd className="tabular-nums">
                    {formatGbp(order.totalMinor - order.walletAppliedMinor)}
                  </dd>
                </div>
              </>
            )}
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

      <OrderCockpit
        orderId={order.id}
        orderStatus={order.status}
        lines={order.lines}
        shippingEnabled={shipping?.enabled ?? false}
        clickAndDropEnabled={clickAndDrop?.enabled ?? false}
        isSuperAdmin={me?.role === "super_admin"}
      />
    </div>
  );
}
