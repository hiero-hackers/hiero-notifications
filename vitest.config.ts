import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The live suite (real mainnet mirror) runs via `npm run test:live`
    // only — network uptime must never fail `npm test` or a CI gate.
    exclude: ["**/node_modules/**", "test/live/**"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // cli.ts is process-level glue, tested as a black box by spawning the
      // real bin (test/cli.test.ts) — v8 can't observe a child process, so
      // counting it here would only misreport covered behavior as 0%.
      exclude: ["src/cli.ts"],
      // Ratchet, don't rot: floors sit just under the current numbers so
      // coverage can only be raised deliberately, never lowered silently.
      // The gap to 100 is mostly the CLI and delivery I/O — worth closing
      // (raise these as tests land).
      thresholds: {
        statements: 93,
        branches: 83,
        functions: 96,
        lines: 93,
      },
    },
  },
});
