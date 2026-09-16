# Enterprise form spam + the preheader injection — a plan

## Why this exists

Ops kept receiving "New Enterprise enquiry" emails with random-string names,
`<nonsense> LLC` organisations, a harvested third-party email address and a
message that was nothing but digits. The recon found two separate things, and
only one of them is about the spam.

1. **The spam is bot form-filling, not an attack.** No injection strings, no
   URLs, no probing. `POST /enterprise-enquiries` is `@Public()` by design
   (ADR 0101) and has no honeypot, no timing check and no captcha — the repo has
   zero references to any of them. The 5/min per-IP throttle is a flood guard and
   was never going to stop thirteen submissions from scattered IPs.

   Crucially, the endpoint is **not** an open relay: `notifyOps` sends only to
   `SUPPORT_INBOX_EMAIL`, never to the address the submitter typed, and sets no
   `Reply-To`. Kudos cannot be used to email-bomb the third party whose address
   the bots are borrowing. If anyone ever adds a "thanks for your enquiry"
   autoresponder to this form, that stops being true.

2. **A real defect, found while checking the above.** `renderBrandedEmail`
   interpolates `preheader` and `heading` as raw HTML. Every one of the fourteen
   callers escapes `bodyHtml` and every one of them forgets `preheader` — which
   is an API-design trap, not fourteen independent mistakes.

   Proven, not assumed, by calling the compiled function with a hostile name: the
   payload closes the hidden preheader `<div>` and renders a live, visible,
   clickable link in the email body.

   Five call sites pass user-controlled data into `preheader`. Ranked by reach:

   | Call site                                            | Who controls it                                                                                                           | Who receives the email                    |
   | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
   | `messages.service.ts:493` (`who`)                    | **anonymous, unauthenticated** — `senderName` on `POST /messages/:slug/replies`, 80 chars (a working payload fits in ~56) | **a paying customer**                     |
   | `team.service.ts:439` (`accountName`)                | any account owner                                                                                                         | an outside invitee who has not joined yet |
   | `enterprise.service.ts:130` (`name`, `organisation`) | anonymous                                                                                                                 | the Kudos ops inbox                       |
   | `support.service.ts:703` (`detail.subject`)          | a signed-in subscriber                                                                                                    | the Kudos ops inbox                       |
   | `returns.service.ts:938` (`recipientName`)           | the same account's own member                                                                                             | that same account's customer              |

   Severity: medium. Not browser XSS — mail clients strip scripts — but content
   injection that carries Kudos branding and Kudos's sending reputation. No
   evidence of exploitation; the spam submissions are not attempting it.

## Decisions

- **D1 — The layout escapes its own fields; callers keep owning `bodyHtml`.**
  The fix goes in `renderBrandedEmail`, not in five call sites. A call-site fix
  leaves the trap armed for the sixth caller. `bodyHtml` stays trusted-HTML by
  contract, because that is the field whose whole purpose is markup, and every
  caller already escapes into it correctly.

- **D2 — Nothing is ever rejected. Spam is classified, not refused.**
  ADR 0101's principle is "a sales lead is never lost". A spam verdict changes
  only two things: the row's status, and whether ops get an email. The row is
  still written, and ops can restore it.

- **D3 — The bot must not learn it was caught.** A spam submission returns the
  same `201` and the same `{id, status}` ack shape as a real one, so a crawler
  gets no signal to tune against. `status` on a caught row is `spam`, but the
  bot has nothing to compare it to.

- **D4 — Only high-confidence signals, and each records why.** A fuzzy "spam
  score" risks binning a real prospect, which costs far more than a cluttered
  queue. Three rules, each individually defensible, each stored as a
  `spamReason` so ops can see the filter's reasoning and challenge it.

- **D5 — A missing timing field is not evidence.** `formOpenedAt` is absent for
  any caller that is not our web form. Absence is neutral; only a _present_
  timestamp that is implausibly recent counts against a submission.

- **D6 — `spam` must not leak into the default queue.** `list()` currently
  defines "open" as `status: { not: "closed" }`. Adding a fourth enum value
  silently pipes every caught bot into the view ops actually look at, which is
  the exact outcome this work exists to prevent. The default becomes
  `notIn: ["closed", "spam"]`, pinned by a test.

## Phase 1 — Close the injection

- `apps/api/src/email/email-layout.ts`: escape `preheader`, `heading`,
  `cta.label` and `cta.url` inside `renderBrandedEmail`. Strip control characters
  (including newlines) from the fields that land in a `<title>` or a subject-like
  position. Document `bodyHtml` as the one deliberately-trusted field.
- Escaping `&` to `&amp;` inside an `href` is the correct HTML encoding and is
  decoded by browsers and mail clients, so CTA URLs keep working. Verify against
  the existing email specs rather than assuming.
- New `apps/api/src/email/email-layout.spec.ts`, including the exact breakout
  payload from the recon. Every assertion mutation-tested: revert the guard,
  confirm the test fails.
- No call-site changes. That the five vulnerable callers become safe without
  being touched _is_ the fix.

## Phase 2 — The spam gate

- Prisma: `EnterpriseEnquiryStatus` gains `spam`; `EnterpriseEnquiry` gains
  `spamReason String?`. One additive migration.
- `packages/shared-types`: `enterpriseEnquiryStatusSchema` gains `spam`;
  `createEnterpriseEnquirySchema` gains two optional fields — `contactReference`
  (the honeypot) and `formOpenedAt`.
- New `apps/api/src/enterprise/spam-signals.ts` — a pure, unit-testable
  `classifyEnquiry(input, now): string | null`:
  - `honeypot` — `contactReference` is non-empty. Named so no browser or
    password-manager autofill heuristic targets it.
  - `submitted-too-fast` — `formOpenedAt` is present, not in the future, and
    less than 3s before submission.
  - `message-has-no-words` — the message contains no alphabetic character at
    all. This is what caught `8838149310`, and a genuine enquiry always has
    letters.
- `enterprise.service.ts`: classify, persist with the verdict, skip `notifyOps`
  when caught, return the normal ack (D3). Fix the `open` filter (D6).
- DTOs: the honeypot and timestamp on create; `spam` added to the list filter
  and the triage transition.
- Tests: a unit spec per rule, plus e2e for each rule end-to-end, for "a caught
  lead never appears in the open queue", and for "the ack is indistinguishable".

## Phase 3 — The ops surface

- A **Spam** tab on `/admin/enterprise`, its status label and badge, a
  **Not spam** action restoring a row to `new`, and a **Spam** action on a `new`
  lead so ops can bin one the filter missed.
- Show the recorded `spamReason` on a caught row, so the filter is auditable by
  the people it serves rather than a black box.
- A web test covering restore and the reason being visible.

## Out of scope, deliberately

- **Cloudflare Turnstile.** The right next step _if_ this escalates to a
  determined spammer, but it adds a third-party dependency, a key to manage and
  friction on a page that sells to large prospects. Naive form-fillers — which is
  all the evidence shows — do not need it.
- **Content heuristics beyond D4's third rule.** "Random-looking consonant
  strings" would catch `Oiecujreu LLC`, and would also catch real organisation
  names that are acronyms or non-English. Not worth a lost lead.
- **An Enterprise autoresponder.** Noted here only because adding one would turn
  this endpoint into the relay it currently is not.
