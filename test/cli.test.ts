/**
 * The CLI as a black box — spawn the real bin (dist/cli.js, built by
 * `prepare`) and assert its exit behavior. Process-level glue is tested at
 * the process level; the logic behind it (parseArgs/argsToConfig/loadConfig)
 * has unit tests in config.test.ts.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const run = (...args: string[]) =>
  spawnSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8", timeout: 15000 });

describe("hiero-notify CLI", () => {
  it("no arguments: usage on stderr, exit 2", () => {
    const res = run();
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("hiero-notify --config FILE");
  });

  it("a missing config file: clear error, exit 2", () => {
    const res = run("--config", "does-not-exist.json");
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("could not read config");
  });

  it("a config with no accounts: usage, exit 2", () => {
    const res = run("--min-inflow", "100"); // flags but zero accounts
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("usage:");
  });
});

describe("strict flags (audit-2 #1)", () => {
  it("a mistyped flag is an error, not a silent no-op", () => {
    const res = run("0.0.1234", "--staet", "state.json");
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("unknown flag(s): --staet");
  });
});

describe("--replay mode (audit-2 #6)", () => {
  it("needs no accounts — replays a dead-letter file to the console", () => {
    const dir = mkdtempSync(join(tmpdir(), "hiero-notify-cli-replay-"));
    try {
      const dead = join(dir, "dead.jsonl");
      writeFileSync(
        dead,
        JSON.stringify({
          failedAt: "2026-01-01T00:00:00Z",
          channel: "webhook(json)",
          error: "down",
          notification: {
            id: "account-activity:0.0.9:0.0.9-1-2",
            source: "account-activity",
            subject: "0.0.9",
            text: "Receipt for account 0.0.9",
            at: "2026-01-01T00:00:00Z",
            payload: {},
          },
        }) + "\n",
      );
      const res = run("--replay", dead);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Receipt for account 0.0.9");
      expect(res.stderr).toContain("replayed 1/1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
