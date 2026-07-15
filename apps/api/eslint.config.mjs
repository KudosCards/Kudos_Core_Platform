// @ts-check
import nestjsConfig from "@kudos/config/eslint/nestjs";

export default [
  { ignores: ["eslint.config.mjs", "dist/**"] },
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
