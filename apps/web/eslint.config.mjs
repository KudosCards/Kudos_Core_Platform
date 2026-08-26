import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import eslintConfigPrettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  eslintConfigPrettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    /**
     * Colour has to mean something on the screens customers see.
     *
     * Before the status tokens existed there was one tint in the system — the
     * brand accent — so an informational banner was painted the same red as a
     * declined card, and a customer told us so. Everything else improvised with
     * raw Tailwind palette classes, which is how the app ended up with four
     * different ambers for "needs attention" and two greens for "done", none of
     * them checked for contrast. (Two were below WCAG AA: the error style at
     * 3.71:1 and pill-positive at 4.35:1.)
     *
     * Use --info / --success / --warning / --danger instead: `bg-warning-soft`,
     * `text-danger`, `border-success/30`. Their ratios are asserted by
     * scripts/check-design-tokens.mjs, so a token can't drift below AA the way
     * a hand-picked hex silently did.
     *
     * Scoped to the customer-facing app. The design editor's canvas chrome and
     * the ops console are exempt: their colours are affordances (selection,
     * snap guides, queue heat) rather than promises to a customer, and forcing
     * them through four semantic tokens would say less, not more.
     */
    files: [
      "src/app/(app)/**/*.tsx",
      "src/app/(auth)/**/*.tsx",
      "src/components/**/*.tsx",
      "src/lib/**/*.ts",
    ],
    ignores: ["src/app/(app)/designs/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/(?:^|\\s)(?:dark:)?(?:hover:|focus:|group-hover:)?(?:bg|text|border|ring|divide|from|to)-(?:amber|emerald|rose|red|green|yellow|orange|blue|sky|teal|lime)-[0-9]/]",
          message:
            "Use the status colour tokens (info / success / warning / danger) rather than a raw Tailwind palette colour — e.g. bg-warning-soft, text-danger. See globals.css. Ops and the design editor are exempt.",
        },
        {
          selector:
            "TemplateElement[value.raw=/(?:^|\\s)(?:dark:)?(?:hover:|focus:|group-hover:)?(?:bg|text|border|ring|divide|from|to)-(?:amber|emerald|rose|red|green|yellow|orange|blue|sky|teal|lime)-[0-9]/]",
          message:
            "Use the status colour tokens (info / success / warning / danger) rather than a raw Tailwind palette colour — e.g. bg-warning-soft, text-danger. See globals.css. Ops and the design editor are exempt.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
