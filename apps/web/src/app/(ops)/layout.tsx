import { redirect } from "next/navigation";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { LogoutButton } from "../(app)/logout-button";

/**
 * The internal ops shell — a separate surface from the customer app. Gated on
 * platform-admin status (GET /fulfillment/me), NOT account membership, so ops
 * staff without a tuition-centre account aren't bounced to onboarding. See
 * docs/adr/0010-phase-5-fulfillment-ops.md.
 */
export default async function OpsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const result = await serverApiFetch<{ userId: string }>("/fulfillment/me").catch(
    (error: unknown) => {
      // 403 = authenticated but not a platform operator — send them to the
      // customer app rather than showing an ops surface they can't use.
      if (error instanceof ApiError && error.status === 403) {
        redirect("/dashboard");
      }
      throw error;
    },
  );
  if (!result) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1">
      <aside className="flex w-56 shrink-0 flex-col justify-between border-r border-black/10 px-4 py-6 dark:border-white/10">
        <div className="flex flex-col gap-2 text-sm font-medium">
          <span className="px-3 text-xs font-semibold tracking-wide text-foreground/40 uppercase">
            Operations
          </span>
          <Link
            href="/fulfillment"
            className="rounded-md px-3 py-2 text-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
          >
            Fulfillment queue
          </Link>
          <Link
            href="/catalog"
            className="rounded-md px-3 py-2 text-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
          >
            Card catalog
          </Link>
        </div>
        <div className="flex flex-col gap-2 border-t border-black/10 pt-4 text-sm dark:border-white/10">
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
