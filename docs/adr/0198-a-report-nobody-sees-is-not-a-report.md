# 0198 — A report nobody sees is not a report

## Status

Accepted — implemented. From an external code review (finding 19 of 37).

## Context

The CSV importer returns a full account of what it did: how many contacts were
created and updated, and every row it could not take, with the reason. The UI to
show that was already built and good — counts, a disclosure listing rejected rows
with their reasons, another for fields it had to skip, both capped at twenty with
an "…and N more".

On the Contacts page nobody ever saw it.

`CsvImport` set its summary state and then called `onImported`. The page's
handler closed the dialog on the next line, `Modal` renders `null` when closed,
and React unmounted `CsvImport` in the same commit — destroying the report
between it being set and it being painted. The handler also took no argument, so
the summary it was handed went nowhere.

The get-started wizard keeps the component mounted, and there the report shows
correctly. So the code was right in one place, wrong in the other, and the
difference was invisible from either file on its own.

What that costs: a school imports five hundred contacts and a hundred and twenty
rows are rejected — postcodes that aren't postcodes, dates that aren't
`dd/mm/yyyy`. The dialog closes, the count reads 380, and nothing anywhere says
a hundred and twenty rows were dropped or why. They find out weeks later, when a
hundred and twenty birthdays never produce a card.

## Decision

**The dialog stays open after an import.** It already renders the report
correctly; the only thing wrong was closing it. The page still resets its
filters and reloads the table underneath, so the contacts are already there when
the person closes the dialog themselves.

**The report also stays on the page**, when there is something to act on. A run
that dropped rows should not stop existing because a dialog was dismissed —
someone who closes it before reading is exactly the person the report is for. A
clean import raises nothing: no banner follows anyone around a page for good
news.

To do that without a second, drifting copy of the markup, the report moved into
its own component, `ImportReport`, rendered both inside the dialog and on the
page.

An earlier draft of this had the page banner carry a "See which →" button that
reopened the dialog. It would not have worked: closing the dialog unmounts
`CsvImport` along with the summary it holds, so reopening shows an empty file
picker. A button that promises detail and delivers a blank form is worse than no
button, and the fix was to show the detail in place rather than to link to it.

## Consequences

- The person who imported the file learns, at the time, which rows failed and
  why — while they still have the spreadsheet open.
- The Contacts page and the get-started wizard now behave the same way, which is
  what made this hard to see in the first place.
- One renderer for the report; two places that use it.

Three mutations were run, each caught: closing the dialog on success again,
dropping the page-level report, and raising it for a clean import too.

## What this does not do

The report lives for as long as the page does. Nothing is stored server-side, so
a refresh loses it, and there is no import history to go back to. That is a
larger piece of work — the API would have to keep the summary against the import
— and it is not what this finding is about. What it fixes is the case where the
information existed, was rendered, and was thrown away half a frame later.
