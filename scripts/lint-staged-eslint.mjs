#!/usr/bin/env node
/**
 * Lint staged files with the ESLint that owns them.
 *
 * ESLint lives in each workspace here, not at the root: `apps/api`, `apps/web`
 * and `packages/shared-types` each have their own flat config, and those
 * configs resolve relative to the working directory they run in. `apps/api`
 * pins `parserOptions.project` for type-aware rules; `apps/web` scopes its
 * design-token rule to `src/app/(app)/**` and friends. Run any of that from the
 * repo root and the patterns miss, the project is not found, and a lint that
 * appears to pass has checked nothing.
 *
 * That is why `.husky/pre-commit` ran Prettier alone: a root-level `eslint`
 * has no config to run with. So this groups the staged files by the workspace
 * that owns them and runs each workspace's own ESLint binary with that
 * workspace as the working directory — the same way `pnpm turbo run lint` does,
 * so the hook and CI agree about what is an error.
 *
 * It is a fast filter, not a replacement for CI. Type-aware rules can flag a
 * file that is not itself staged (a changed export breaking its consumer), and
 * only the full per-workspace run sees those. This catches the mistakes you
 * just made in the files you just touched, which is most of them, in seconds
 * rather than a five-minute round trip.
 *
 * Invoked by `lint-staged` with absolute paths. Exits non-zero to stop the
 * commit.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Flat-config filenames ESLint 9 looks for, in its own precedence order. */
const CONFIG_NAMES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
];

/**
 * The nearest directory at or above `file` that holds a flat config — the
 * working directory ESLint has to run in for that file. Null when there is
 * none below the repo root, which the caller treats as a gap rather than a
 * pass.
 */
export function eslintRootFor(file, repoRoot = REPO_ROOT) {
  let dir = dirname(resolve(file));
  while (dir.startsWith(repoRoot)) {
    if (CONFIG_NAMES.some((name) => existsSync(resolve(dir, name)))) return dir;
    if (dir === repoRoot) break;
    dir = dirname(dir);
  }
  return null;
}

/** Staged files grouped by the workspace whose ESLint owns them. */
export function groupByEslintRoot(files, repoRoot = REPO_ROOT) {
  const groups = new Map();
  const unowned = [];
  for (const file of files) {
    const root = eslintRootFor(file, repoRoot);
    if (root === null) {
      unowned.push(file);
      continue;
    }
    const existing = groups.get(root);
    if (existing) existing.push(file);
    else groups.set(root, [file]);
  }
  return { groups, unowned };
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) return 0;

  const { groups, unowned } = groupByEslintRoot(files);
  let failed = false;

  if (unowned.length > 0) {
    // Never a silent skip. `lint-staged` was configured for a year while
    // `.husky/pre-commit` did not exist, and husky exits 0 on a missing hook —
    // 248 files drifted before anyone noticed a thing that reported nothing.
    console.error(
      `No ESLint config covers:\n${unowned
        .map((file) => `  ${relative(REPO_ROOT, file)}`)
        .join("\n")}\nAdd an eslint.config for that workspace, or narrow the ` +
        `lint-staged glob in package.json so these are not sent here.`,
    );
    failed = true;
  }

  for (const [root, owned] of groups) {
    const binary = resolve(root, "node_modules/.bin/eslint");
    if (!existsSync(binary)) {
      // Deliberately not falling back to whatever `eslint` is on PATH: that
      // could be a global install of another major version, running against a
      // config it does not understand.
      console.error(
        `ESLint is not installed in ${relative(REPO_ROOT, root)} — run \`pnpm install\`.`,
      );
      failed = true;
      continue;
    }
    const result = spawnSync(
      binary,
      // --no-warn-ignored: a staged file the workspace ignores (its own
      // eslint.config.mjs, anything under dist/) otherwise warns, and
      // --max-warnings 0 turns that warning into a failed commit.
      ["--max-warnings", "0", "--no-warn-ignored", ...owned.map((file) => relative(root, file))],
      { cwd: root, stdio: "inherit" },
    );
    if (result.error) {
      console.error(
        `Could not run ESLint in ${relative(REPO_ROOT, root)}: ${result.error.message}`,
      );
      failed = true;
    } else if (result.status !== 0) {
      failed = true;
    }
  }

  return failed ? 1 : 0;
}

// Only act when run as a command; importing the helpers must not lint anything.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
