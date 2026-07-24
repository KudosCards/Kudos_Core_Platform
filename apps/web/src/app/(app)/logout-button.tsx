"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton({ redirectTo = "/login" }: { redirectTo?: string } = {}) {
  const router = useRouter();

  async function handleClick() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      className="text-sm text-foreground/60 hover:text-foreground"
    >
      Log out
    </button>
  );
}
