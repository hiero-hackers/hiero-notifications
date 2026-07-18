/**
 * The flag table is the single source of truth — these tests make drift
 * impossible: every spec must be honored by the parser's whitelist, rendered
 * in the help text, documented in the README, and (if it maps to config)
 * consumed by argsToConfig.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FLAG_SPECS, KNOWN_FLAGS, usage, argsToConfig, parseArgs } from "../src/flags.js";

describe("flag table as single source of truth", () => {
  it("KNOWN_FLAGS is exactly the table", () => {
    expect([...KNOWN_FLAGS].sort()).toEqual(FLAG_SPECS.map((f) => f.name).sort());
  });

  it("usage() renders every flag with its help", () => {
    const text = usage();
    for (const f of FLAG_SPECS) {
      expect(text).toContain(`--${f.name}`);
      expect(text).toContain(f.help.slice(0, 20));
    }
  });

  it("the README documents every flag", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    for (const f of FLAG_SPECS) {
      expect(readme, `README is missing --${f.name}`).toContain(`--${f.name}`);
    }
  });

  it("every config-mapped flag survives the round trip", () => {
    const config = argsToConfig(
      parseArgs([
        "0.0.1",
        ...["--webhook", "https://w", "--slack", "https://s", "--discord", "https://d"],
        ...["--min-inflow", "5", "--min-outflow", "7", "--staking"],
        ...["--state", "s.json", "--dead-letter", "d.jsonl", "--type", "CRYPTOTRANSFER"],
        ...["--network", "testnet", "--interval", "30", "--backfill", "3"],
      ]),
    );
    expect(config).toMatchObject({
      accounts: ["0.0.1"],
      network: "testnet",
      pollIntervalSeconds: 30,
      backfill: 3,
      state: "s.json",
      deadLetter: "d.jsonl",
      transactionType: "CRYPTOTRANSFER",
      deliveries: { webhook: "https://w", slack: "https://s", discord: "https://d" },
    });
    expect(config.triggers).toEqual(
      expect.arrayContaining([
        { type: "staking" },
        { type: "inflow", minHbar: 5 },
        { type: "outflow", minHbar: 7 },
      ]),
    );
  });
});
