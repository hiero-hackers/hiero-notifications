import { defineConfig } from "vitest/config";

// The LIVE suite only — real mainnet mirror, read-only. Kept out of the
// default config so `npm test` and CI gates never depend on network uptime.
export default defineConfig({
  test: {
    include: ["test/live/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
