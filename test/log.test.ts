/**
 * The structured logger — human prose by default, parseable JSON lines when
 * enabled, and JSON-only events (the poll heartbeat) silent in human mode.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { log, logJson, setJsonLogs } from "../src/log.js";

const capture = (): string[] => {
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((s: string) => void lines.push(s));
  return lines;
};
afterEach(() => {
  setJsonLogs(false);
  vi.restoreAllMocks();
});

describe("log", () => {
  it("human mode prints the prose untouched", () => {
    const lines = capture();
    log("delivery-retry", { channel: "slack" }, "[slack] retrying…");
    expect(lines).toEqual(["[slack] retrying…"]);
  });

  it("json mode emits one parseable object with ts and event", () => {
    setJsonLogs(true);
    const lines = capture();
    log("delivery-retry", { channel: "slack", waitMs: 500 }, "ignored prose");
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.event).toBe("delivery-retry");
    expect(parsed.channel).toBe("slack");
    expect(parsed.waitMs).toBe(500);
    expect(new Date(parsed.ts).getTime()).toBeGreaterThan(0);
  });

  it("the poll heartbeat exists only in json mode", () => {
    const lines = capture();
    logJson("poll", { delivered: 3 });
    expect(lines).toEqual([]); // human mode: silent
    setJsonLogs(true);
    logJson("poll", { delivered: 3 });
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "poll", delivered: 3 });
  });
});
