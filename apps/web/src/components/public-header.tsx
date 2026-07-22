"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useCartCount } from "@/lib/cart";

const CORAL = "#ef5b52";

export interface PublicNavLink {
  href: string;
  label: string;
}

/**
 * The shared header for the public, logged-out site (home + card library +
 * basket) — Moonpig-style, catering to one-off visitors: browse nav, a
 * Reminders prompt that nudges sign-up, a Basket with a live count, and Sign in.
 * Marketing-styled (coral accent), independent of the app shell. See
 * docs/adr/0025.
 */
export function PublicHeader({ navLinks = [] }: { navLinks?: PublicNavLink[] }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" className="shrink-0">
          <Image
            src="/marketing/logo.png"
            alt="Kudos Cards"
            width={410}
            height={475}
            className="h-11 w-auto sm:h-14"
            priority
          />
        </Link>

        {navLinks.length > 0 && (
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-slate-900">
                {link.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-1 sm:gap-3">
          <RemindersButton />
          <BasketButton />
          <Link
            href="/login"
            className="rounded-full px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:px-4"
            style={{ backgroundColor: CORAL }}
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

/** The basket icon + live count badge, linking to /basket. */
function BasketButton() {
  const count = useCartCount();
  return (
    <Link
      href="/basket"
      className="relative flex flex-col items-center rounded-lg px-2 py-1 text-slate-700 hover:text-slate-900"
      aria-label={`Basket${count > 0 ? ` (${count} ${count === 1 ? "card" : "cards"})` : ""}`}
    >
      <span className="relative">
        <BagIcon />
        {count > 0 && (
          <span
            className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ backgroundColor: CORAL }}
          >
            {count}
          </span>
        )}
      </span>
      <span className="mt-0.5 hidden text-[11px] font-medium sm:block">Basket</span>
    </Link>
  );
}

/**
 * The Reminders icon. For a signed-out visitor it opens a prompt to sign up /
 * sign in to save birthdays and get reminders (the reminders feature needs an
 * account). A signed-in visitor is sent straight to their calendar.
 */
function RemindersButton() {
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session));
    });
    return () => {
      active = false;
    };
  }, []);

  // Close the prompt on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={popoverRef}>
      {signedIn ? (
        <Link
          href="/calendar"
          className="flex flex-col items-center rounded-lg px-2 py-1 text-slate-700 hover:text-slate-900"
          aria-label="Reminders"
        >
          <BellIcon />
          <span className="mt-0.5 hidden text-[11px] font-medium sm:block">Reminders</span>
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex flex-col items-center rounded-lg px-2 py-1 text-slate-700 hover:text-slate-900"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Reminders"
        >
          <BellIcon />
          <span className="mt-0.5 hidden text-[11px] font-medium sm:block">Reminders</span>
        </button>
      )}

      {open && !signedIn && (
        <div
          role="dialog"
          aria-label="Get birthday reminders"
          className="absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl border border-slate-100 bg-white p-4 shadow-xl"
        >
          <p className="text-sm font-semibold text-slate-900">Never miss a birthday</p>
          <p className="mt-1 text-sm text-slate-600">
            Create a free account to save birthdays to your calendar and get a reminder before each
            one — or let us send the card automatically.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <Link
              href="/register"
              className="rounded-full px-4 py-2 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: CORAL }}
              onClick={() => setOpen(false)}
            >
              Sign up free
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-slate-200 px-4 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              Sign in
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}
