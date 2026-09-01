# Account security checklist

The controls in the codebase all assume one thing: that nobody else can log into the dashboards
behind it. Someone with the Railway login reads the database directly, and no amount of
authorisation code in the API stands in their way. In practice **account takeover of one of these
dashboards is a larger real-world risk than anything in the application itself**, and it is the
one part no commit can fix.

This is the list. It is also the answer when an enterprise prospect, an insurer or a customer's
security questionnaire asks how access to your systems is controlled — which they will.

Legend: 🧑 = you (dashboard/manual), 🤖 = enforced in code.

Last reviewed: **2026-09-01** — update this date whenever you work through the list.

---

## 1. Turn on two-factor authentication 🧑

Every account below can reach customer data, take the platform down, or move money. Use an
authenticator app (1Password, Authy, Google Authenticator) rather than SMS where the choice is
offered — SMS can be taken over by porting the number.

| Service      | What it holds                            | 2FA on? | Notes                                   |
| ------------ | ---------------------------------------- | ------- | --------------------------------------- |
| **Railway**  | The API and the production **database**  | ☑       | Highest impact. Direct data access.     |
| **Supabase** | Auth, user accounts, file storage        | ☑       | Also holds the service-role key.        |
| **Stripe**   | Payments, payouts, customer billing      | ☑       | Money. Enable payout notifications too. |
| **GitHub**   | All source code, deploy pipeline         | ☑       | A push to `main` deploys to production. |
| **Netlify**  | The public website                       | ☑       | Defacement / redirect risk.             |
| **Airtable** | The card catalog                         | ☑       | Feeds what customers can buy.           |
| **Brevo**    | Transactional + marketing email          | ☑       | Can email your whole customer list.     |
| **Google**   | Analytics, Search Console                | ☑       | Lower impact, still worth it.           |
| **Sentry**   | Error reports (may contain user context) | ☑       |                                         |

Tick the boxes as you go and commit the change, so the file records what is actually true.

## 2. Store the recovery codes properly 🧑

Every service issues one-time recovery codes when you enable 2FA. Losing them while also losing
your phone means losing the account.

- ☑ Saved in a password manager, **not** in a note on the same laptop or phone that holds the
  authenticator app.
- ☑ Not committed to this repository, ever. (`.env*` is gitignored, but recovery codes do not
  belong in a repo at all.)

## 3. Review who has access 🧑

- ☐ **GitHub** — Settings → Collaborators. Remove anyone who has left or no longer needs it.
- ☐ **Railway, Netlify, Supabase, Stripe** — check each project's members list for the same.
- ☐ **No shared logins.** One account per person. A shared password cannot be revoked for one
  person, and an audit log against a shared account tells you nothing about who did what.
- ☐ Anyone with production access has 2FA on their own account, not just you.

## 4. Protect the deploy path 🧑

A push to `main` deploys to production, so branch protection is a production control.

- ☐ **GitHub → Settings → Branches → protect `main`**: require a pull request, and require the
  "Lint, typecheck, test, build" status check to pass.
- ☐ Force-pushes to `main` disabled.

## 5. Rotate anything that has been exposed 🧑

If a key has ever been pasted into a chat, an email, a screenshot or a support ticket, treat it as
public and reissue it. Most of these can be rotated with no downtime by updating the Railway
variable and redeploying.

- ☐ `STRIPE_SECRET_KEY` — Stripe dashboard → Developers → API keys.
- ☐ `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API. **Full database access,
  bypasses every rule.** The one to care most about.
- ☐ `CREDENTIALS_ENCRYPTION_KEY` — encrypts customers' stored CRM keys. Rotating this needs a
  re-encryption pass; ask before changing it.
- ☐ `AIRTABLE_API_KEY`, `BREVO_API`, `ROYAL_MAIL_API_KEY`, `CLICK_AND_DROP_API_KEY`.
- ☐ `CATALOG_REVALIDATE_SECRET` — low impact if leaked (forces a catalog refresh, nothing more).

## 6. What the platform already does for you 🤖

Worth knowing, both for reassurance and because these are the questions a security review asks:

- **Authentication is deny-by-default.** Every endpoint requires a valid token unless explicitly
  marked public, so a forgotten guard produces a locked endpoint rather than an open one.
- **Tokens are verified strictly** — the signing algorithm is pinned, so the commonest JWT
  bypass does not apply.
- **Operator rights come from the database, not the token.** A forged "I am an admin" claim gets
  nothing.
- **Customer data is isolated per account.** Records are fetched by their id _and_ their account
  id together, so a valid login plus a guessed id from another customer returns nothing.
- **No SQL injection surface.** All hand-written SQL is parameterised.
- **Payment webhooks are signature-verified** before the payload is parsed — nobody can forge
  "this invoice was paid".
- **Stored third-party credentials are encrypted** (AES-256-GCM); customer API keys are hashed
  and compared in constant time.
- **Support attachments are private**, served through short-lived signed URLs, and checked
  against the requesting account.
- **CI fails on a high or critical advisory** in any dependency that ships.

## 7. What is not covered here

Being honest about the edges, because a checklist that overstates itself is worse than none:

- No penetration test has been carried out. This is a configuration checklist, not an assurance
  report.
- Backups and disaster recovery are not covered — that is a separate exercise (what Supabase
  retains, how far back, and whether a restore has ever actually been tried).
- Nothing here covers the physical handling of printed cards or the postal chain.
