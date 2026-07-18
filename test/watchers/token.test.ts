/**
 * The token watcher, both layers:
 *  - pure logic — `diffHolders` snapshots and the `tokenDeltaAtLeast`
 *    condition (no I/O);
 *  - the loop through the injection seam — baseline, deltas, and the
 *    persisted-snapshot restart catch-up guarantee.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffHolders,
  tokenBalanceWatcher,
  tokenDeltaAtLeast,
  type TokenMirror,
} from "../../src/watchers/token.js";
import type { TokenBalanceChange } from "../../src/watchers/token.js";

const snap = (entries: Array<[string, bigint]>) => new Map(entries);

describe("diffHolders", () => {
  it("reports an exact delta for a holder present in both snapshots", () => {
    const changes = diffHolders(snap([["0.0.1", 100n]]), snap([["0.0.1", 175n]]));
    expect(changes).toEqual([
      { account: "0.0.1", before: 100n, after: 175n, delta: 75n, reason: "changed" },
    ]);
  });

  it("skips holders whose balance did not move", () => {
    expect(diffHolders(snap([["0.0.1", 100n]]), snap([["0.0.1", 100n]]))).toEqual([]);
  });

  it("flags a new holder as `entered` (before 0)", () => {
    const changes = diffHolders(snap([]), snap([["0.0.9", 500n]]));
    expect(changes).toEqual([
      { account: "0.0.9", before: 0n, after: 500n, delta: 500n, reason: "entered" },
    ]);
  });

  it("flags a departed holder as `exited` (after 0, negative delta)", () => {
    const changes = diffHolders(snap([["0.0.7", 300n]]), snap([]));
    expect(changes).toEqual([
      { account: "0.0.7", before: 300n, after: 0n, delta: -300n, reason: "exited" },
    ]);
  });
});

describe("tokenDeltaAtLeast", () => {
  const change = (delta: bigint, decimals = 6): TokenBalanceChange => ({
    tokenId: "0.0.456858",
    network: "mainnet",
    symbol: "USDC",
    decimals,
    account: "0.0.1",
    before: 0n,
    after: delta,
    delta,
    reason: "changed",
  });

  it("matches a move at or above the threshold and rejects a smaller one", () => {
    const big = tokenDeltaAtLeast(100_000); // 100k whole tokens
    expect(big.matches(change(250_000_000000n))).toBe(true); // 250k
    expect(big.matches(change(5_000000n))).toBe(false); // 5
  });

  it("uses absolute value, so outflows count too", () => {
    expect(tokenDeltaAtLeast(100).matches(change(-100_000000n))).toBe(true); // −100
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), "hiero-notify-token-"));
  dirs.push(d);
  return d;
};

const fakeMirror = (holders: () => Record<string, string>): TokenMirror => ({
  async queryTokenById() {
    return { symbol: "WHALE", decimals: 2 };
  },
  async queryTokenBalances() {
    return {
      data: Object.entries(holders()).map(([accountId, balance]) => ({ accountId, balance })),
      next: null,
    };
  },
});

describe("token watcher loop", () => {
  it("first poll baselines silently; later polls emit exact deltas", async () => {
    let balances: Record<string, string> = { "0.0.1": "10000" };
    const watcher = tokenBalanceWatcher({
      tokenId: "0.0.4444",
      mirror: fakeMirror(() => balances),
    });
    expect(await watcher()).toHaveLength(0); // baseline
    balances = { "0.0.1": "17500" };
    const [n] = await watcher();
    expect(n!.payload).toMatchObject({
      tokenId: "0.0.4444",
      network: "mainnet",
      symbol: "WHALE",
      before: 10000n,
      after: 17500n,
      delta: 7500n,
    });
    expect(n!.id).toBe("token-balances:0.0.4444:0.0.1:10000->17500");
  });

  it("a persisted snapshot makes a RESTART catch up instead of re-baselining", async () => {
    const statePath = join(scratch(), "token.state.json");
    let balances: Record<string, string> = { "0.0.1": "10000" };
    const first = tokenBalanceWatcher({
      tokenId: "0.0.4444",
      statePath,
      mirror: fakeMirror(() => balances),
    });
    await first(); // baseline, persisted

    balances = { "0.0.1": "5000" }; // the whale dumps while we are down
    const restarted = tokenBalanceWatcher({
      tokenId: "0.0.4444",
      statePath,
      mirror: fakeMirror(() => balances),
    });
    const caught = await restarted();
    expect(caught).toHaveLength(1); // pre-fix: silently re-baselined, emitted nothing
    expect(caught[0]!.payload).toMatchObject({ before: 10000n, after: 5000n, delta: -5000n });
  });
});
