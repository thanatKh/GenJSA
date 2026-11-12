/* Unit tests (npm test) — pure logic, no browser: the outside-AI parsers and
 * prompts, the schema helpers behind numbering and counts, validation, drafts.
 * Whole-screen flows live in e2e/ (npm run test:e2e, Playwright). */
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
    },
  }),
);
