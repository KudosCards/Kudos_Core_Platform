import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A guard, not a unit test.
 *
 * A card prints `OrderRecipient.documentSnapshot` — its own copy, taken when it
 * was bought. A `SavedDesign` is a reusable template the account edits between
 * sends, and for most of this platform's life every render path read that
 * instead. Editing a design therefore rewrote every order that had ever used
 * it, and it reached production: an account's single-card orders rendered each
 * other's messages, one of them carrying two.
 *
 * Nothing in the schema prevents that coming back. A new report, a new preview,
 * a new export — each is one `savedDesign: { select: { document: true } }` away
 * from printing whatever the template says today. So the rule is mechanical:
 * the files that may load a design's document are a short list, and each one
 * says why.
 *
 * Writing this guard is what turned up the storage reaper, which had been
 * complete before a card had artwork of its own and silently stopped being so.
 *
 * See docs/order-artwork-plan.md.
 */
const SRC = join(__dirname, "..");

/**
 * Every file allowed to load a design's `document`, and why.
 *
 * Each reason is about the design *as a design*. None of them is about what an
 * existing card shows — that is the distinction this guard exists to hold.
 */
const ALLOWED: Record<string, string> = {
  "saved-designs/saved-designs.service.ts":
    "owns the design — creating it, validating it, archiving it",
  "batch-orders/batch-orders.service.ts":
    "print-checks it and copies it onto a new card, and re-copies it for the super-admin correction",
  "auto-send/auto-send.service.ts": "copies it onto the card it is creating",
  "storage-maintenance/storage-reaper.service.ts":
    "walks every design to decide which stored objects are still referenced — about the assets, not about any card",
};

/** A Prisma read of the SavedDesign model. */
const LOAD =
  /\.savedDesign\s*\.\s*(?:findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow)\s*\(/g;

/** `savedDesign: {` — the model reached as a relation. */
const RELATION = /\bsavedDesign\s*:\s*\{/g;

/** The `document` field as a Prisma select key. Word-bounded, so the card's own
 *  `documentSnapshot` is not mistaken for the design's artwork. */
const SELECTS_DOCUMENT = /\bdocument\s*:\s*true\b/;

/** The text between a matched opening delimiter and its partner. */
function balanced(source: string, start: number, open: string, close: string): string {
  let depth = 1;
  let index = start;
  while (index < source.length && depth > 0) {
    if (source[index] === open) depth += 1;
    else if (source[index] === close) depth -= 1;
    index += 1;
  }
  return source.slice(start, index - 1);
}

/**
 * Whether a file can obtain a design's document from the database.
 *
 * Delimiter-matched rather than pattern-matched, because both forms nest and a
 * flat regex answers the wrong question. A direct read counts when it names no
 * `select` at all — Prisma then returns every column, artwork included, which
 * is the easiest way to read it by accident.
 */
function loadsDesignDocument(source: string): boolean {
  for (const match of source.matchAll(LOAD)) {
    const args = balanced(source, match.index + match[0].length, "(", ")");
    if (!args.includes("select:") || SELECTS_DOCUMENT.test(args)) return true;
  }
  for (const match of source.matchAll(RELATION)) {
    if (SELECTS_DOCUMENT.test(balanced(source, match.index + match[0].length, "{", "}"))) {
      return true;
    }
  }
  return false;
}

/** Prose is not code: a comment explaining why a card no longer reads the
 *  design is not a read, and a guard that cannot tell gets suppressed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
  });
}

describe("a card's artwork", () => {
  const files = sourceFiles(SRC).map((path) => ({
    name: path.slice(SRC.length + 1),
    source: withoutComments(readFileSync(path, "utf8")),
  }));

  it("finds the source at all (the scan still works)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("comes from the design only where a design is what is meant", () => {
    const readers = files
      .filter((file) => loadsDesignDocument(file.source))
      .map((file) => file.name);
    // Exact, in both directions: a new path that reads the template fails, and
    // so does an entry left behind by a file that no longer needs to.
    expect(readers.sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it("is what the print run hands to the printer", () => {
    const printRun = files.find((file) => file.name === "fulfillment/fulfillment.service.ts");
    // Pinned by value rather than by absence: "does not read the design" would
    // also be satisfied by a print run that read nothing at all.
    expect(printRun?.source).toContain("document: job.orderRecipient.documentSnapshot");
  });

  it("is counted as referenced before any stored object is reaped", () => {
    // The reaper deletes storage. Its referenced-set was complete while a card
    // had no artwork of its own; now a url can live only in a bought card's
    // snapshot, and missing that page means deleting artwork out from under a
    // card waiting to print.
    const reaper = files.find(
      (file) => file.name === "storage-maintenance/storage-reaper.service.ts",
    );
    expect(reaper?.source).toContain("orderRecipient.findMany");
    expect(reaper?.source).toContain("documentSnapshot");
  });

  it("would notice either form — the patterns are what call sites write", () => {
    // Proves the scan can fail. Without this a broken pattern would let every
    // path through while cards printed each other's messages again.
    expect(
      loadsDesignDocument("await tx.savedDesign.findUnique({ where, select: { document: true } })"),
    ).toBe(true);
    // No select at all: Prisma returns the artwork too, which is the easiest
    // way to read it without meaning to.
    expect(loadsDesignDocument("this.prisma.savedDesign.findFirst({ where: { id } })")).toBe(true);
    expect(
      loadsDesignDocument("savedDesign: { select: { id: true, name: true, document: true } },"),
    ).toBe(true);

    // And that the card's own copy is never mistaken for the design's.
    expect(loadsDesignDocument("savedDesign: { select: { id: true, name: true } },")).toBe(false);
    expect(loadsDesignDocument("documentSnapshot: true,")).toBe(false);
    expect(
      loadsDesignDocument("orderRecipient.findMany({ select: { documentSnapshot: true } })"),
    ).toBe(false);
  });
});
