import { redirect } from "next/navigation";
import Link from "next/link";
import type { Account } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { LogoutButton } from "./logout-button";

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Recipients", href: "/recipients" },
];

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const result = await serverApiFetch<Account>("/accounts/me").catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 403) {
      redirect("/onboarding");
    }
    throw error;
  });
  if (!result) {
    redirect("/login");
  }
  const account = result;

  return (
    <div className="flex flex-1">
      <aside className="flex w-56 shrink-0 flex-col justify-between border-r border-black/10 px-4 py-6 dark:border-white/10">
        <nav className="flex flex-col gap-2 text-sm font-medium">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-2 border-t border-black/10 pt-4 text-sm dark:border-white/10">
          <span className="truncate font-medium">{account.name}</span>
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
