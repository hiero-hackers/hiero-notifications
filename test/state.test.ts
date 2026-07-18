/**
 * The persistent cursor file — the guarantee that restarts catch up instead
 * of silently swallowing missed events. Failure bias under test: unreadable
 * state must THROW (never silently re-baseline), unwritable state must not
 * lose the previous good file.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadState, saveState } from "../src/state.js";

const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "hiero-notify-state-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("state round trip", () => {
  it("saves and loads cursors exactly", () => {
    const path = join(scratch(), "state.json");
    saveState(path, new Map([["0.0.1234", "1721300000.000000001"]]));
    expect(loadState(path)).toEqual(new Map([["0.0.1234", "1721300000.000000001"]]));
  });

  it("a missing file is a normal first run — empty cursors", () => {
    expect(loadState(join(scratch(), "never-written.json"))).toEqual(new Map());
  });

  it("overwrites atomically — the file is always complete JSON", () => {
    const path = join(scratch(), "state.json");
    saveState(path, new Map([["0.0.1", "1.0"]]));
    saveState(
      path,
      new Map([
        ["0.0.1", "2.0"],
        ["0.0.2", "3.0"],
      ]),
    );
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed).toEqual({ version: 1, entries: { "0.0.1": "2.0", "0.0.2": "3.0" } });
  });
});

describe("failure bias: never silently re-baseline", () => {
  it("corrupt JSON throws with remediation in the message", () => {
    const path = join(scratch(), "state.json");
    writeFileSync(path, "{not json");
    expect(() => loadState(path)).toThrow(/not valid JSON.*re-baseline/s);
  });

  it("a NEWER version names the downgrade instead of guessing", () => {
    const path = join(scratch(), "state.json");
    writeFileSync(path, JSON.stringify({ version: 2, entries: {} }));
    expect(() => loadState(path)).toThrow(/newer than this build.*downgraded/s);
  });

  it("an unsupported shape throws instead of guessing", () => {
    const path = join(scratch(), "state.json");
    writeFileSync(path, JSON.stringify({ version: 1, entries: null }));
    expect(() => loadState(path)).toThrow(/unsupported shape/);
  });
});
