/**
 * Generates the branded Supabase Auth email templates (signup confirmation,
 * magic link, password reset, invite, email change) from the SAME shared
 * layout the app's transactional emails use — so the auth emails Supabase
 * sends can never drift from the Kudos Cards brand.
 *
 * Supabase renders Go-template variables like {{ .ConfirmationURL }}; we pass
 * those through verbatim as the CTA URL. Output lands in docs/email-templates/
 * for a human to paste into Supabase → Authentication → Email Templates
 * (see that folder's README.md).
 *
 * Run from apps/api after a build:  pnpm build && node scripts/generate-auth-email-templates.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBrandedEmail } from "../dist/email/email-layout.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "..", "docs", "email-templates");

// The public host the logo is served from. The web app exposes it at
// /marketing/logo.png; swap this if the app moves hosts (see README).
const WEB_APP_URL = "https://kudoscards.co.uk";

/** Supabase's confirmation-link placeholder, passed straight through. */
const CONFIRMATION_URL = "{{ .ConfirmationURL }}";

const templates = [
  {
    file: "confirm-signup.html",
    subject: "Confirm your Kudos Cards account",
    preheader: "Confirm your email to start sending cards that mean something.",
    heading: "Welcome to Kudos Cards 🎉",
    bodyHtml: `
      <p style="margin:0 0 16px">You're one tap away. Confirm your email address to activate your account and start sending cards.</p>
      <p style="margin:0">If you didn't create a Kudos Cards account, you can safely ignore this email.</p>`,
    cta: { url: CONFIRMATION_URL, label: "Confirm my email" },
  },
  {
    file: "magic-link.html",
    subject: "Your Kudos Cards sign-in link",
    preheader: "Your secure sign-in link for Kudos Cards.",
    heading: "Sign in to Kudos Cards",
    bodyHtml: `
      <p style="margin:0 0 16px">Tap the button below to sign in. This link works once and expires shortly.</p>
      <p style="margin:0">If you didn't request this, you can safely ignore this email.</p>`,
    cta: { url: CONFIRMATION_URL, label: "Sign in" },
  },
  {
    file: "reset-password.html",
    subject: "Reset your Kudos Cards password",
    preheader: "Reset your Kudos Cards password.",
    heading: "Reset your password",
    bodyHtml: `
      <p style="margin:0 0 16px">We received a request to reset your password. Tap below to choose a new one.</p>
      <p style="margin:0">If you didn't ask for this, you can safely ignore this email — your password won't change.</p>`,
    cta: { url: CONFIRMATION_URL, label: "Choose a new password" },
  },
  {
    file: "invite.html",
    subject: "You've been invited to Kudos Cards",
    preheader: "You've been invited to join a team on Kudos Cards.",
    heading: "You've been invited",
    bodyHtml: `
      <p style="margin:0 0 16px">You've been invited to join a team on Kudos Cards. Accept the invitation to set up your account.</p>
      <p style="margin:0">If you weren't expecting this, you can safely ignore this email.</p>`,
    cta: { url: CONFIRMATION_URL, label: "Accept invitation" },
  },
  {
    file: "change-email.html",
    subject: "Confirm your new email address",
    preheader: "Confirm the change to your Kudos Cards email address.",
    heading: "Confirm your new email",
    bodyHtml: `
      <p style="margin:0 0 16px">Confirm the change from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong> for your Kudos Cards account.</p>
      <p style="margin:0">If you didn't request this change, please contact us right away.</p>`,
    cta: { url: CONFIRMATION_URL, label: "Confirm the change" },
  },
];

mkdirSync(outDir, { recursive: true });
for (const t of templates) {
  const html = renderBrandedEmail({
    webAppUrl: WEB_APP_URL,
    preheader: t.preheader,
    heading: t.heading,
    bodyHtml: t.bodyHtml,
    cta: t.cta,
  });
  writeFileSync(join(outDir, t.file), `${html}\n`, "utf8");
  console.log(`wrote docs/email-templates/${t.file}  (subject: ${t.subject})`);
}
