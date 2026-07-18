import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig, conditionFor, deliveriesFor } from "../src/config.js";
import { parseArgs, argsToConfig } from "../src/flags.js";
import type { NotifyConfig } from "../src/config.js";

describe("parseArgs → argsToConfig (CLI flags)", () => {
  it("turns flags into triggers and delivery channels", () => {
    const config = argsToConfig(
      parseArgs(["0.0.1", "--min-inflow", "100", "--staking", "--slack", "https://s"]),
    );
    expect(config.accounts).toEqual(["0.0.1"]);
    expect(config.triggers).toEqual([{ type: "staking" }, { type: "inflow", minHbar: 100 }]);
    expect(config.deliveries?.slack).toBe("https://s");
  });
});

describe("conditionFor", () => {
  it("defaults to any balance change", () => {
    expect(conditionFor({ accounts: ["0.0.1"] }).name).toBe("balance-change");
  });

  it("combines multiple triggers with OR", () => {
    const c = conditionFor({
      accounts: ["0.0.1"],
      triggers: [{ type: "staking" }, { type: "inflow", minHbar: 100 }],
    });
    expect(c.name).toContain("staking-reward");
    expect(c.name).toContain("inflow>=100h");
  });
});

describe("deliveriesFor (on/off + urls)", () => {
  it("console is on by default; a URL string enables a channel", () => {
    const d = deliveriesFor({ accounts: ["0.0.1"], deliveries: { slack: "https://s" } });
    expect(d.map((x) => x.name)).toEqual(["console", "slack"]);
  });

  it("a channel with enabled:false is skipped (URL kept, just off)", () => {
    const d = deliveriesFor({
      accounts: ["0.0.1"],
      deliveries: {
        console: false,
        discord: { url: "https://d", enabled: false },
        slack: { url: "https://s" },
      },
    });
    expect(d.map((x) => x.name)).toEqual(["slack"]); // no console, no discord
  });
});

describe("loadConfig", () => {
  it("reads and validates a JSON config file", () => {
    const path = join(tmpdir(), `notify-${process.pid}.json`);
    const config: NotifyConfig = { accounts: ["0.0.9"], triggers: [{ type: "staking" }] };

    writeFileSync(path, JSON.stringify(config));
    expect(loadConfig(path).accounts).toEqual(["0.0.9"]);
  });

  it("rejects a config with no accounts", () => {
    const path = join(tmpdir(), `notify-bad-${process.pid}.json`);

    writeFileSync(path, JSON.stringify({ triggers: [] }));
    expect(() => loadConfig(path)).toThrow(/accounts/);
  });
});

describe("flag → config wiring for the newer options (audit #5)", () => {
  it("state, dead-letter, and type flags land in the config", () => {
    const config = argsToConfig(
      parseArgs([
        "0.0.1",
        "--state",
        "s.json",
        "--dead-letter",
        "d.jsonl",
        "--type",
        "CRYPTOTRANSFER",
      ]),
    );
    expect(config.state).toBe("s.json");
    expect(config.deadLetter).toBe("d.jsonl");
    expect(config.transactionType).toBe("CRYPTOTRANSFER");
  });

  it("a disabled channel object is ignored; an enabled one is used", () => {
    const deliveries = deliveriesFor({
      accounts: ["0.0.1"],
      deliveries: {
        console: false,
        slack: { url: "https://slack.example", enabled: false },
        discord: { url: "https://discord.example", enabled: true },
      },
    });
    expect(deliveries.map((d) => d.name)).toEqual(["discord"]);
  });
});

describe("strictness: typos are errors, not silent no-ops (audit-2 #1)", () => {
  it("loadConfig rejects unknown keys by name", () => {
    const path = join(tmpdir(), `notify-cfg-${process.pid}.json`);
    writeFileSync(path, JSON.stringify({ accounts: ["0.0.1"], trigers: [] }));
    expect(() => loadConfig(path)).toThrow(/unknown key\(s\): trigers/);
  });

  it("parseArgs exposes every seen flag for rejection", () => {
    const args = parseArgs(["0.0.1", "--staet", "s.json", "--json"]);
    expect(args.keys).toContain("staet");
    expect(args.keys).toContain("json");
  });
});

describe("the shipped example config is a valid config (drift guard)", () => {
  // Two live drift paths this pins: a new NotifyConfig field added to the
  // example but not KNOWN_CONFIG_KEYS would make the example THROW for every
  // user; a key renamed in code but not here would ship a broken example.
  it("notify.config.example.json parses through loadConfig", () => {
    const path = fileURLToPath(new URL("../notify.config.example.json", import.meta.url));
    const config = loadConfig(path);
    expect(config.accounts.length).toBeGreaterThan(0);
    expect(config.state).toBeDefined();
    expect(config.deadLetter).toBeDefined();
    expect(deliveriesFor(config).length).toBeGreaterThan(0);
    expect(conditionFor(config).name).toBeTruthy();
  });
});
