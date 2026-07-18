/**
 * Dead-letter replay — the at-least-once promise completed: what the dead
 * letter preserved can be re-delivered, and a failing replay preserves it
 * again rather than losing it.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { replayDeadLetters } from "../src/replay.js";
import type { Delivery } from "../src/types.js";
import { makeNotification } from "./fixtures.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), "hiero-notify-replay-"));
  dirs.push(d);
  return d;
};

const deadLetterFile = (dir: string, subjects: string[]): string => {
  const path = join(dir, "dead.jsonl");
  const lines = subjects.map((subject) =>
    JSON.stringify(
      {
        failedAt: "2026-01-01T00:00:00Z",
        channel: "webhook(json)",
        error: "connection refused",
        notification: makeNotification({ subject }),
      },
      (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
    ),
  );
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
};

describe("replayDeadLetters", () => {
  it("re-delivers every preserved notification to the current channels", async () => {
    const path = deadLetterFile(scratch(), ["0.0.1", "0.0.2"]);
    const seen: string[] = [];
    const channel: Delivery = {
      name: "fixed-webhook",
      async deliver(n) {
        seen.push(n.subject);
      },
    };
    const result = await replayDeadLetters(path, [channel]);
    expect(result).toEqual({ total: 2, delivered: 2, failed: 0 });
    expect(seen).toEqual(["0.0.1", "0.0.2"]);
  });

  it("what fails again is preserved again — never lost", async () => {
    const dir = scratch();
    const path = deadLetterFile(dir, ["0.0.1", "0.0.2"]);
    const dead: Delivery = {
      name: "still-broken",
      async deliver(n) {
        if (n.subject === "0.0.2") throw new Error("still refusing");
      },
    };
    const result = await replayDeadLetters(path, [dead]);
    expect(result).toEqual({ total: 2, delivered: 1, failed: 1 });
    const retry = readFileSync(`${path}.retry.jsonl`, "utf8").trim().split("\n");
    expect(retry).toHaveLength(1);
    expect(JSON.parse(retry[0]!).notification.subject).toBe("0.0.2");
  });
});
