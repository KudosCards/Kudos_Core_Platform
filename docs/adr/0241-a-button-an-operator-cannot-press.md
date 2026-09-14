# 0241 — A button an operator cannot press

## Status

Accepted — implemented. The ops UI now gates every control that reaches a
super-admin route, and the API-side guard that pins those routes was found to
have been blind to five of them.

## Context

ADR 0040 draws the line: super admin manages the operator team and platform
settings; `ops` is the schema default and the role every invited operator starts
on. ADR 0215's follow-up put a `SuperAdminGuard` next to every platform-settings
mutation and a test to keep it there.

The server has been right ever since. The UI was not. An ops operator opening
`/admin` saw "Enable seat billing", "Save windows", "Set live" — and got a 403
on pressing any of them. Nothing was at risk; the guard did its job. But a
control that is shown and then refused teaches an operator that the tool is
broken, and it is the kind of thing that gets worked around rather than
reported.

Two of the detail pages had already solved it for themselves, with the right
sentence written next to the fix: "an operator who cannot use it should not be
shown it" (`subscribers/[id]/page.tsx`). The dashboard panels never picked it
up — four of them added one at a time, each reasonably matching the last.

## Decision

### Hidden or read-only, decided by what is left when the control goes

Not everything gets hidden, because hiding is not always the kinder answer.

- **Settings panels stay, and go inert.** Seeing the configuration is an
  operator's job — which is exactly why the API leaves these read routes
  unrestricted — so removing the panel would take away something they are
  entitled to. `fieldset[disabled]` does this natively for every input, select
  and button inside it, by the DOM rather than by each panel remembering to
  thread a flag through its own markup.
- **Lone action buttons disappear.** "Run the backfill" has nothing to read once
  it cannot be pressed; a dead button is clutter, not information.

### The gate fails closed

`useIsSuperAdmin()` returns `false` outside its provider. A permission gate that
unlocks itself when its context goes missing is worse than one that is
occasionally too strict, and "too strict" here costs an operator one click they
could not have completed anyway.

### The route list is derived from the API, not written down again

The obvious rule — "anything under `/admin`" — is wrong in **both** directions,
and was:

| `/admin/…` mutation           | guard                | who does it |
| ----------------------------- | -------------------- | ----------- |
| `PATCH /admin/support/:id`    | `PlatformAdminGuard` | ops work    |
| `PATCH /admin/enterprise-…`   | `PlatformAdminGuard` | ops work    |
| `POST /admin/notifications/…` | `PlatformAdminGuard` | ops work    |
| `PUT /admin/print/card-size`  | `+ SuperAdminGuard`  | platform    |

Gating the first three would take away work an operator is hired to do. The API
is the only thing that knows which is which, so `super-admin-controls.test.ts`
reads the controllers and derives the list. Two further corrections came out of
running it rather than reasoning about it: `GET` and `PUT /admin/print/card-size`
are the same path, so the method matters; and a server component's read cannot
be gated by a React context and is a read by construction, so the rule is scoped
to client components that also mutate.

## The defect the derivation found

`admin-team.controller.ts` writes its guard **below** the route decorator:

```ts
@Post("team/invites")
@UseGuards(PlatformAdminGuard, SuperAdminGuard)
```

`admin.controller.ts` writes it above. `admin-mutations-guarded.spec.ts` compared
each mutating route to _the line before it_, so the team controller could never
have been covered by it — and when that spec was widened the day before (ADR 0240) to take a list of controllers rather than one file, the list grew without
anyone noticing the assumption underneath it.

Every one of those five routes is in fact guarded; this was a blind spot in the
test, not a hole in the server. But a guard that cannot see half the code it
claims to cover is the same shape of mistake ADR 0238 named: a conclusion drawn
from the part of the system in view.

**Fixed.** Both scans now read the whole contiguous decorator block around a
route, so either order is seen. `admin-team.controller.ts` joins the list, with
one exemption — `POST /admin/access` is how a first-time operator becomes an
operator at all, so requiring the role it grants would make the surface
unreachable — and a test that the exemption still points at that route, because
an exemption that has drifted onto another line silently excuses whatever moved
there.

## Consequences

- One fetch of `/admin/me`, already made by the shell, now serves every panel.
- A new panel that mutates a platform setting fails `super-admin-controls.test.ts`
  until someone writes down how it is gated. The list's values are reasons, not
  ticks.
- `ops-role.test.tsx` presses the buttons. A scan can only see that a wrapper is
  written down; what an ops operator experiences is whether the control moves,
  so the test renders a real panel as an `ops` operator, clicks, and asserts no
  request was sent.
- Mutation-tested, and one mutation earned its keep: deleting a panel's wrapper
  while leaving its `import` behind passed the scan, because the marker check
  looked for the name rather than the element. It looks for `<SuperAdminEditable>`
  now — a half-finished edit is exactly what this is meant to catch.
- This changes what is **shown**, never what is **allowed**. The server remains
  the authority, and a hand-crafted request is refused exactly as before.
