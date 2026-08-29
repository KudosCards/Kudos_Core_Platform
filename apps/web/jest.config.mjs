import nextJest from "next/jest.js";

/**
 * Component tests for the screens where a mistake costs money or loses a
 * birthday: Approvals, the send-timing picker, checkout, and the truncation
 * notice. Deliberately not an attempt to cover 39,000 lines of markup.
 *
 * `next/jest` supplies the SWC transform, the `@/` alias and the CSS/font stubs,
 * so there is no bespoke transform config to drift from the app's own build.
 *
 * These tests cannot see a hydration mismatch: jsdom runs in Node, so both
 * "server" and "client" share Node's ICU and agree with each other by
 * construction. The Node-versus-browser date divergence that bit twice is found
 * by running both engines, not here. See ADR 0175.
 */
const createJestConfig = nextJest({ dir: "./" });

export default createJestConfig({
  testEnvironment: "jsdom",
  // Before the framework, so the app's import-time env schema is satisfied by
  // the time a component's module graph loads.
  setupFiles: ["<rootDir>/jest.env.ts"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}"],
  // `next/jest` maps CSS, images and fonts but not the project's own alias — it
  // configures SWC's transform, while Jest's *resolver* still needs telling.
  // Mirrors `paths` in tsconfig.json; there is one alias and it is this.
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
});
