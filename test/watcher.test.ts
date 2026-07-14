import { describe, it, expect } from "vitest";
import { pollOnce } from "../src/watcher.js";
import { inflowAtLeast } from "../src/condition.js";
import type { Delivery, Source } from "../src/types.js";
import { makeReceipt } from "./fixtures.js";

describe("pollOnce", () => {
  it("delivers only the receipts that match the condition", async () => {
    const delivered: string[] = [];
    const recorder: Delivery = { name: "recorder", async deliver(e) { delivered.push(e.account); } };
    const source: Source = async () => [
      { account: "0.0.1", receipt: makeReceipt({ movements: [{ asset: "HBAR", amount: 5_000_000_000n, kind: "hbar" }] }) }, // 50 ℏ
      { account: "0.0.2", receipt: makeReceipt({ movements: [{ asset: "HBAR", amount: 20_000_000_000n, kind: "hbar" }] }) }, // 200 ℏ
    ];

    const n = await pollOnce({ source, deliveries: [recorder], condition: inflowAtLeast(100) });
    expect(n).toBe(1);
    expect(delivered).toEqual(["0.0.2"]); // only the 200 ℏ inflow qualified
  });

  it("builds the event with rendered text/html and an ISO timestamp", async () => {
    let captured: { text: string; at: string } | undefined;
    const grab: Delivery = { name: "grab", async deliver(e) { captured = { text: e.text, at: e.at }; } };
    const source: Source = async () => [{ account: "0.0.5", receipt: makeReceipt({ account: "0.0.5" }) }];

    await pollOnce({ source, deliveries: [grab], now: () => new Date("2026-07-14T12:00:00Z") });
    expect(captured?.text).toContain("Receipt for account 0.0.5");
    expect(captured?.at).toBe("2026-07-14T12:00:00.000Z");
  });

  it("a failing delivery does not stop the others", async () => {
    const ok: string[] = [];
    const boom: Delivery = { name: "boom", async deliver() { throw new Error("nope"); } };
    const good: Delivery = { name: "good", async deliver(e) { ok.push(e.account); } };
    const source: Source = async () => [{ account: "0.0.9", receipt: makeReceipt() }];

    const n = await pollOnce({ source, deliveries: [boom, good] });
    expect(n).toBe(1);
    expect(ok).toEqual(["0.0.9"]); // good still delivered despite boom throwing
  });
});
