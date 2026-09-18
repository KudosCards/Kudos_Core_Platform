// @ts-check
import nestjsConfig from "@kudos/config/eslint/nestjs";

export default [
  // `scripts/**` holds standalone node utilities (one-shot migrations, the
  // Stripe price setup, the printer calibration sheet). They are plain .mjs,
  // they are not in the tsconfig project, and `pnpm lint` only globs
  // {src,test}/**/*.ts — so CI has never linted them. Without this the
  // pre-commit hook, which lints whatever you staged, fails with "file not
  // found in any of the provided project(s)" the moment one of them is touched.
  { ignores: ["eslint.config.mjs", "dist/**", "scripts/**"] },
  ...nestjsConfig,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
      sourceType: "commonjs",
    },
  },
];
