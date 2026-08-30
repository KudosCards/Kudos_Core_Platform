# 0205 — The view should follow the work

## Status

Accepted — implemented. From an external code review (finding 36 of 37).

## Context

`handleImageUpload` mints a signed URL, reads the file's dimensions, uploads to
storage and then places the image. Three awaits, seconds of wall-clock on a
phone photo — plenty of time to switch to another face of the card.

The review's account: "captures `activePage` at click time. Switching face
during a slow upload places the image on the previous face and selects an id not
on the visible page — the panel reads 'Nothing selected' and the image is out of
sight with no feedback."

The symptom is exactly right. The diagnosis is half right, and the half it gets
wrong changes what the fix should be.

## Where the image was going, and why that was not the bug

`insertImage` read `activePage` from the render its closure was created in — the
render the click happened in. So the image was placed on the face the person was
looking at **when they asked for it**, not the one they had wandered to. That is
the right destination. A photo added from the front belongs on the front; moving
it to the back because someone glanced there while it uploaded would be worse,
and would edit a face they never asked to change.

The defect is that nothing said so. The editor stayed on the back, the selection
pointed at an element on the front, and the properties panel — which renders
against the selected id — read "Nothing selected". The image existed, on the
right page, invisible, with the one piece of UI that could have explained it
saying nothing was there.

## Decision

Place the image on the face it was added from, explicitly, and **bring the
editor back to that face** so it is seen arriving, selected and ready to move.

`handleImageUpload` captures `targetPage` before its first await and passes it
down; `insertImage` takes the page as an argument rather than reading state, and
calls `setActivePage(page)`.

## On the two mutations that are not caught

Three mutations were run. Only one — removing `setActivePage(page)` — changes
behaviour, and it is caught.

Dropping the explicit `targetPage`, and counting the cascade offset from the
active page instead of the target page, both leave behaviour identical today.
That is the same stale closure doing the right thing by accident: without the
argument, `insertImage`'s default reads the `activePage` of the render it was
created in, which is the face the upload started from.

They are kept anyway, and the distinction from ADR 0203's unreachable guard is
worth stating. That guard defended a case the UI cannot produce. These make a
correctness that currently rests on an invisible React detail explicit instead:
wrap `insertImage` in a `useCallback`, or hoist it, and the accidental version
silently starts placing images on whichever face the person happens to be
looking at. An argument that says what it means costs nothing and cannot rot in
that direction.

Recorded rather than reported as covered — a mutation that changes nothing
proves nothing.
