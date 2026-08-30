# 0200 — An emptied field is an instruction

## Status

Accepted — implemented. From an external code review (finding 21 of 37).

## Context

The contact editor built its PATCH body in two loops that disagreed:

```ts
// PATCH is a merge, so only send these when set (blank = leave unchanged).
for (const key of ["dateOfBirth", "email"]) {
  const value = str(key);
  if (value) body[key] = value;
}
// Address is always sent so it can be *cleared*, not just added…
for (const key of ["addressLine1", "addressLine2", "addressCity", "addressPostcode"]) {
  const value = str(key);
  body[key] = value === "" ? null : value;
}
```

Both comments are honest about what their loop does. Only one is right about
what the user meant. Emptying a field the user could see, and then pressing
Save, is an instruction — not an absence of one. The address loop, four lines
down, already treated it that way.

So clearing a date of birth did nothing, and said nothing: the form closed with
no error and the header still read the old date. A contact imported with a
US-order date mix-up could not be corrected by clearing the field, which is the
natural way to fix a value you know is wrong but cannot replace. And because a
date of birth is what schedules a birthday card, the wrong-dated card kept being
generated — on an auto-send account, paid for out of the wallet, every year.

## Decision

One loop over every optional field, blank meaning null:

```ts
for (const key of ["dateOfBirth", "email", "addressLine1", …]) {
  const value = str(key);
  body[key] = value === "" ? null : value;
}
```

## The API already did its part

This is entirely client-side. `PATCH /recipients/:id` already accepts `null` for
both columns — `@IsOptional()` passes null through, and the update path already
asks `dto.dateOfBirth !== undefined`, so clearing a date of birth also runs
`realignBirthdayOccasion`, which with no date of birth retires every live
birthday row (ADR 0185). The stale birthday goes with the stale date, and no
further card is scheduled.

That was verified rather than assumed: an API test sends
`{ dateOfBirth: null, email: null }`, checks both columns are cleared, and
checks the contact has no birthday occasions left. It passed before any change
to the API, which is the useful result — it says the fix belongs in one place
and names which.

## Consequences

- A field the user emptied is emptied.
- Clearing a wrong date of birth stops the card it was generating, rather than
  requiring someone to notice and skip it each year.
- The two loops that disagreed are one loop.

Two mutations were run, each caught: omitting the two fields when blank (the
original), and nulling every field regardless of content — the latter because a
loop this uniform is exactly where an over-eager simplification would land.
