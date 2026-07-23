import type { Account } from "@kudos/shared-types";
import Link from "next/link";
import { redirect } from "next/navigation";
import { serverApiFetch } from "@/lib/api.server";
import { Icons, type IconName } from "@/components/icons";
import { ReminderEmailsToggle } from "./reminder-emails-toggle";

interface SettingCard {
  label: string;
  description: string;
  href: string;
  icon: IconName;
}

const CARDS: SettingCard[] = [
  {
    label: "Team",
    description: "Invite colleagues and manage roles.",
    href: "/team",
    icon: "team",
  },
  {
    label: "Integrations",
    description: "Connect your CRM and sync contacts.",
    href: "/integrations",
    icon: "integrations",
  },
  {
    label: "Billing & plan",
    description: "Your subscription, invoices, and plan.",
    href: "/billing",
    icon: "billing",
  },
  {
    label: "Wallet",
    description: "Top up and review your balance.",
    href: "/wallet",
    icon: "wallet",
  },
];

/**
 * The settings hub — one home for the account-management surfaces that used to
 * each sit in the sidebar (Team, Integrations, Billing, Wallet), plus in-app
 * notification preferences. Keeps the sidebar lean. See docs/adr/0030.
 */
export default async function SettingsPage() {
  const account = await serverApiFetch<Account>("/accounts/me");
  if (!account) {
    redirect("/login");
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted">Manage your account, team, billing, and notifications.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = Icons[card.icon];
          return (
            <Link
              key={card.href}
              href={card.href}
              className="card flex items-start gap-3 p-5 transition-colors hover:bg-foreground/[0.02]"
            >
              <span className="rounded-lg bg-accent-soft p-2 text-accent">
                <Icon className="size-5" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{card.label}</span>
                <span className="text-sm text-muted">{card.description}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Notifications</h2>
        <div className="card p-5">
          <ReminderEmailsToggle initial={account.reminderEmailsEnabled} />
        </div>
      </section>
    </div>
  );
}
