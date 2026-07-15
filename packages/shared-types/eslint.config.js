// @ts-check
const base = require("@kudos/config/eslint/base");

module.exports = [
  { ignores: ["eslint.config.js"] },
  ...base,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
  },
];
