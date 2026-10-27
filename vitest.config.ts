import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The Chromia module's own unit suite — the 30 files Pacific ERP runs with
 * `npm run test:chromia`, copied unchanged. The Chromia rules the ERP tested
 * with `node --test` (tests/chromia*.test.ts) are copied unchanged too and
 * keep their own runner: `npm run test:node`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/chromia/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
