// @ts-check
const base = require("./base");

module.exports = [
  ...base,
  {
    rules: {
      // Nest relies on decorator-injected params that look "unused" to the parser.
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
];
