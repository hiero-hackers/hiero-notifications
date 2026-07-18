import { describe, it, expect, vi } from "vitest";
import { pollOnce } from "../src/watcher.js";
import { inflowAtLeast } from "../src/watchers/account.js";
import type { Delivery, Watcher } from "../src/types.js";
import type { Receipt } from "@hiero-hackers/hiero-receipts";
import { makeReceipt, makeNotification } from "./fixtures.js";

describe("pollOnce", () => {
  it("delivers only the notifications whose payload matches the condition", async () => {
    const delivered: string[] = [];
    const recorder: Delivery = {
      name: "recorder",
      async deliver(n) {
        delivered.push(n.subject);
      },
    };
    const watcher: Watcher<Receipt> = async () => [
      makeNotification({
        subject: "0.0.1",
        payload: makeReceipt({
          movements: [{ asset: "HBAR", amount: 5_000_000_000n, kind: "hbar" }],
        }),
      }), // 50 ℏ
      makeNotification({
        subject: "0.0.2",
        payload: makeReceipt({
          movements: [{ asset: "HBAR", amount: 20_000_000_000n, kind: "hbar" }],
        }),
      }), // 200 ℏ
    ];

    const n = await pollOnce({ watcher, deliveries: [recorder], condition: inflowAtLeast(100) });
    expect(n).toBe(1);
    expect(delivered).toEqual(["0.0.2"]); // only the 200 ℏ inflow qualified
  });

  it("hands the watcher's rendered fields straight to the delivery", async () => {
    let captured: { text: string; source: string; at: string } | undefined;
    const grab: Delivery = {
      name: "grab",
      async deliver(n) {
        captured = { text: n.text, source: n.source, at: n.at };
      },
    };
    const watcher: Watcher<Receipt> = async () => [
      makeNotification({ text: "You received 200 ℏ", at: "2026-07-14T12:00:00.000Z" }),
    ];

    await pollOnce({ watcher, deliveries: [grab] });
    expect(captured?.text).toBe("You received 200 ℏ");
    expect(captured?.source).toBe("account-activity");
    expect(captured?.at).toBe("2026-07-14T12:00:00.000Z");
  });

  it("a failing delivery does not stop the others", async () => {
    const ok: string[] = [];
    const boom: Delivery = {
      name: "boom",
      async deliver() {
        throw new Error("nope");
      },
    };
    const good: Delivery = {
      name: "good",
      async deliver(n) {
        ok.push(n.subject);
      },
    };
    const watcher: Watcher<Receipt> = async () => [makeNotification({ subject: "0.0.9" })];

    const n = await pollOnce({ watcher, deliveries: [boom, good] });
    expect(n).toBe(1);
    expect(ok).toEqual(["0.0.9"]); // good still delivered despite boom throwing
  });
});

describe("delivery retry and dead-letter (audit #4)", () => {
  const notification = () => makeNotification({ subject: "0.0.9", payload: makeReceipt({}) });

  it("a flaky channel is retried with backoff until it succeeds", async () => {
    let attempts = 0;
    const flaky: Delivery = {
      name: "flaky",
      async deliver() {
        attempts += 1;
        if (attempts < 3) throw new Error("503");
      },
    };
    const n = await pollOnce({
      watcher: async () => [notification()],
      deliveries: [flaky],
      retryBackoffMs: 1,
    });
    expect(n).toBe(1);
    expect(attempts).toBe(3); // first try + two retries
  });

  it("a dead channel exhausts retries, dead-letters the notification, and never blocks others", async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "hiero-notify-dlq-"));
    const dlq = join(dir, "dead.jsonl");
    try {
      const delivered: string[] = [];
      const dead: Delivery = {
        name: "dead-webhook",
        async deliver() {
          throw new Error("connection refused");
        },
      };
      const healthy: Delivery = {
        name: "healthy",
        async deliver(n) {
          delivered.push(n.subject);
        },
      };
      const n = await pollOnce({
        watcher: async () => [notification()],
        deliveries: [dead, healthy],
        deliveryRetries: 1,
        retryBackoffMs: 1,
        deadLetterPath: dlq,
      });
      expect(n).toBe(1);
      expect(delivered).toEqual(["0.0.9"]); // the healthy channel was unaffected
      const lines = readFileSync(dlq, "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]!);
      expect(entry.channel).toBe("dead-webhook");
      expect(entry.error).toContain("connection refused");
      // The FULL notification is preserved — that is what --replay re-delivers.
      expect(entry.notification.subject).toBe("0.0.9");
      expect(entry.notification.id).toMatch(/^account-activity:/);
      expect(entry.notification.payload.feeTinybar).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("watch loop (audit #5)", () => {
  it("polls until aborted, and a throwing poll never kills the loop", async () => {
    const { watch } = await import("../src/watcher.js");
    let polls = 0;
    const controller = new AbortController();
    const watcher: Watcher<Receipt> = async () => {
      polls += 1;
      if (polls === 1) throw new Error("mirror hiccup");
      if (polls >= 3) controller.abort();
      return [];
    };
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((s: string) => void errors.push(s));
    try {
      await watch({
        watcher,
        deliveries: [],
        pollIntervalMs: 1,
        signal: controller.signal,
      });
    } finally {
      spy.mockRestore();
    }
    expect(polls).toBeGreaterThanOrEqual(3); // survived the hiccup, kept polling
    expect(errors.some((e) => e.includes("mirror hiccup"))).toBe(true);
  });
});
