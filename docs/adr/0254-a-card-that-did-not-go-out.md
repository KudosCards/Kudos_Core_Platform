# 0254 — A card that did not go out

## Status

Accepted

## Context

Auto-send (ADR 0013) is the unattended half of the product: a 7am cron finds
every approved occasion whose dispatch date has arrived, orders the card, debits
the wallet and hands it to fulfilment. When it works, `notifyAutoSent` puts a
line in the account's inbox saying so.

When it did not work, nothing happened. `runDue` caught the throw, wrote an
audit row and a server log line, and told the customer nothing at all. Six
conditions can stop a card — no contact, a returned-address hold (ADR 0039), no
approved design, an incomplete postal address, a plan that no longer permits
auto-send, and an empty wallet — and each one was silent.

That was survivable, because a customer who approved a card last week is still
broadly watching for it. It stops being survivable the moment we ask them not
to watch. Scoping "click and forget" (`docs/click-and-forget-plan.md`) turned
this from a gap into a blocker: the entire premise of that feature is that
nobody is looking, and the one moment they need to hear from us was the one
moment nothing reached them. A birthday that silently did not happen is the
worst outcome this product has.

## Decision

Every skip the customer can act on is told to them twice — once in the inbox,
once by email — with the reason and the one thing that fixes it.

### The reason is a code, not a thrown message

`autoSendOne` threw plain `Error`s and `runDue` recorded `error.message`. That
is fine for a log and unusable for anything a person reads: "Occasion has no
approved design" is not a sentence anybody outside this repo should see, and a
message string is not a contract — rewording it would silently change what the
customer is told.

So the throws became `AutoSendSkipError`, carrying one of a closed set of
reasons, and `auto-send-skip.ts` maps each reason to its copy: why it did not
go, what fixes it, where that is done, and a button label. The switch is
exhaustive, so adding a reason without copy is a type error rather than a card
nobody is told about. The audit metadata keeps both — the message for whoever is
reading the log, the code for everything else.

The wallet is the one place this is not simply a rename. `debitAndSettleOrder`
raises `ForbiddenException` for exactly one thing, an insufficient balance, so
that is caught and classified; everything else it can throw stays unclassified
on purpose. Telling somebody to top up a wallet that is already full would be
worse than saying nothing.

### Anything unrecognised is still told, and also escalated

An unclassified failure could have been swallowed as "not a known skip". It is
the opposite: a card did not go out and nobody can say why, which is precisely
when silence is most expensive. The customer is told something went wrong at
our end and that we are looking into it — which is only honest if somebody is,
so it also raises a super-admin alert through `OpsActivityService`. Recognised
skips deliberately do **not** go to Kudos HQ; they are the customer's to act on,
and raising them would bury the real ones.

### The inbox dedupe is the ledger, and the email follows it

A skipped card stays approved and is retried every morning. Told naively, an
unfixed card would be a notification and an email every day until the customer
gave up on us.

`notifyAccount` already deduped on `(kind, entityId)`. It now returns whether
it actually recorded rows — the same signal `notifyAllAdmins` has returned, for
the same reason — and the email is sent only for what that call newly recorded.
One ledger, not two.

The key is `<occasionId>:<reason>`, not the occasion alone. Keyed on the
occasion, a customer who topped up their wallet and still had no address for the
contact would never hear the second half. A composite key is already how
`SegmentsService` handles this.

If writing the inbox row fails, no email is sent either. An email with no record
of having been sent is how somebody gets the same one every morning for a
fortnight.

### One skip is silent, and nothing failed in it

`already_actioned` means the occasion was no longer approved-and-automatic when
the run reached it, because a person checked it out by hand or cancelled it
themselves. Nothing failed, so there is nothing to report.

### The email is not gated on the reminder switch

`reminderEmailsEnabled` is the customer's control over being nudged about cards
they have not sent yet. It is not consent to be kept in the dark about one that
failed. This follows the returned-to-sender email, which has always been
ungated for the same reason.

Resolving which address to write to had grown three identical private copies
(returns, support, messages), each with a comment saying it mirrored the others.
Auto-send would have been the fourth, so it is now
`common/account-email.ts` and all four use it.

## Consequences

- A customer who stops watching still finds out, the morning it happens, that a
  card did not go — and the message names the card, the reason and the fix.
- The wording lives in one table and can be rewritten without touching the
  service or any test that asserts behaviour.
- A daily retry is not a daily email, but a _new_ problem on the same card still
  gets through.
- Kudos HQ hears only about failures nobody can explain, which is the only kind
  an operator can usefully act on.
- `NotificationInboxService.notifyAccount` returns a boolean. Existing callers
  ignore it, and their behaviour is unchanged.
- This does not reduce the number of ways a card can stop. C2 (watching the
  wallet, then refilling it) is the first phase that removes one rather than
  reporting it.
