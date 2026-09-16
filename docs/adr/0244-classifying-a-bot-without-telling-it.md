# 0244 — Classifying a bot without telling it

## Status

Accepted

## Context

Ops were receiving a steady run of "New Enterprise enquiry" emails with
random-string names, `<nonsense> LLC` organisations, a harvested third-party
email address, a ten-digit phone number and a message that was nothing but
digits — `8838149310`.

The recon found ordinary bot form-filling, not an attack. The payloads contained
no injection strings, no URLs and nothing resembling a probe; the fields were
simply every input filled with generated junk, digits wherever the input looked
numeric. The address in them belongs to a real person at a real company and was
almost certainly scraped, making them a victim rather than the sender.

Two things about the endpoint mattered:

- **It is not an open relay, and that is what kept this boring.** `notifyOps`
  sends only to `SUPPORT_INBOX_EMAIL`, never to the address submitted, and sets
  no `Reply-To`. Kudos cannot be used to email-bomb the third party whose address
  the bots borrowed, and no sending reputation is at stake. Adding a "thanks for
  your enquiry" autoresponder to this form would end that, and should not be
  done without revisiting this ADR.

- **The throttle was never going to stop it.** `POST /enterprise-enquiries` is
  `@Public()` by design (ADR 0101) and limited to 5/min per client IP (correctly
  keyed, per ADR 0133). That is a flood guard. Thirteen submissions from
  scattered addresses never approach it. The repository had no honeypot, no
  timing check and no captcha — zero references to any of them.

## Decision

**Classify, never refuse — and never tell the sender which happened.**

1. **Nothing is rejected.** ADR 0101's promise is that a sales lead is never
   lost. A verdict changes exactly two things: the row's status, and whether ops
   are emailed. The submission is written in full either way, and ops can restore
   it. The expensive failure mode here is binning a real Enterprise prospect, not
   letting a bot through.

2. **The acknowledgement reports acceptance, not triage.** A caught submission
   gets the same `201` and the same `{id, status: "new"}` as a real one. The
   public controller hardcodes that status rather than echoing the stored row,
   because echoing it hands a crawler the single bit of feedback it needs to tune
   its way around the gate.

3. **Three rules, each one a human would agree with on sight**, in
   `spam-signals.ts` as a pure function with the clock injected:
   - `honeypot` — a hidden field filled in. Named `contactReference` so no
     browser or password-manager autofill heuristic goes near it, `aria-hidden`
     and out of the tab order so no person can reach it.
   - `submitted-too-fast` — the form was posted under three seconds after it
     rendered.
   - `message-has-no-words` — the message contains no letter in any script.
     This is what caught `8838149310`; the field asks "what are you looking for?"
     and a genuine answer always has a letter in it.

   A fuzzy "spam score" was rejected. It would also have caught `Oiecujreu LLC`
   — and real organisation names that are acronyms or not English.

4. **A missing timestamp is not evidence.** `formOpenedAt` is absent for anything
   that is not our web form, and a client clock can be skewed or simply wrong.
   Only a present, non-future, implausibly-recent value counts against a
   submission.

5. **The verdict is recorded and shown.** `spamReason` is stored and rendered in
   the ops queue in plain English, with an unknown reason falling through to the
   raw value rather than showing nothing. A filter nobody can check is a filter
   nobody should trust; "Not spam" restores a lead in one click.

6. **"Open" excludes `spam` as well as `closed`.** `list()` defined the default
   queue as "not closed". Adding a fourth enum value to that definition would
   have piped every caught bot straight into the view ops actually look at —
   the exact outcome this work exists to prevent. Pinned by an e2e test.

## Consequences

- Ops stop being emailed about bot submissions, and the queue they open is a
  queue of real leads.
- Nothing is destroyed, and a wrong verdict costs one click to undo.
- The ops surface ships in the same change as the API: `spamReason` and the
  fourth status are on the shared `EnterpriseEnquiry` type, so the two halves
  cannot compile apart.
- Covered at three levels — the classifier's rules in isolation, the endpoint
  end-to-end, and both web surfaces. Every guard was mutation-tested: each was
  reverted in turn and a test failed each time, including the two invisible
  client-side pieces (the hidden input and the open-time) that a refactor could
  otherwise drop while leaving every other test green.
- The e2e spec now drives a distinct `X-Forwarded-For` per submission. Not a
  workaround for the throttle so much as the scenario itself: scattered client
  IPs are exactly how this arrives, and exactly why the throttle never helped.
- Cloudflare Turnstile remains the next step up if a determined spammer turns
  up. It is not warranted for naive form-fillers, and it would put friction on a
  page whose job is selling to large prospects.
