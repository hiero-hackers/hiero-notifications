import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs, argsToConfig, loadConfig, conditionFor, deliveriesFor } from "../src/config.js";
import type { NotifyConfig } from "../src/config.js";

describe("parseArgs → argsToConfig (CLI flags)", () => {
  it("turns flags into triggers and delivery channels", () => {
    const config = argsToConfig(parseArgs(["0.0.1", "--min-inflow", "100", "--staking", "--slack", "https://s"]));
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
    const c = conditionFor({ accounts: ["0.0.1"], triggers: [{ type: "staking" }, { type: "inflow", minHbar: 100 }] });
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
      deliveries: { console: false, discord: { url: "https://d", enabled: false }, slack: { url: "https://s" } },
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
