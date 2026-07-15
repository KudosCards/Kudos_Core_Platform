/**
 * Authenticated app shell (the "Workspace"). Route-level auth guarding via
 * Supabase session middleware lands with the auth/tenancy module (Phase 1) —
 * this is a structural placeholder only.
 */
const navItems = ["Dashboard", "Recipients", "Calendar", "Orders", "Account"];

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-1">
      <aside className="w-56 shrink-0 border-r border-black/10 px-4 py-6 dark:border-white/10">
        <nav className="flex flex-col gap-2 text-sm font-medium">
          {navItems.map((item) => (
            <span key={item} className="rounded-md px-3 py-2 text-foreground/70">
              {item}
            </span>
          ))}
        </nav>
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
