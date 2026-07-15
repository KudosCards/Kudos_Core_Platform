import Link from "next/link";

/**
 * Placeholder form. Real submission wires up to Supabase Auth + Account
 * creation once the auth/tenancy module lands (Phase 1).
 */
export default function RegisterPage() {
  return (
    <form className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <label className="flex flex-col gap-1 text-sm">
        Organisation or your name
        <input
          type="text"
          name="name"
          required
          className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          name="email"
          required
          className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          name="password"
          required
          className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
        />
      </label>
      <button
        type="submit"
        className="rounded-full bg-foreground px-4 py-2 text-background transition-opacity hover:opacity-90"
      >
        Start free
      </button>
      <p className="text-sm text-foreground/70">
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </form>
  );
}
