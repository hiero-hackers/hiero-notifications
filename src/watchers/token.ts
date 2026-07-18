/**
 * A second built-in watcher — **HTS token balances**. It polls the holders of
 * one fungible token via `@hiero-hackers/enterprise-mirror` and emits a notification
 * whenever a holding changes between polls, with the exact before → after delta
 * (bigint, in the token's smallest unit). A "whale watch": pair it with a
 * `minBalance` threshold to track only large holders.
 *
 * Its payload is a `TokenBalanceChange`, not a `Receipt` — so it rides the same
 * `watch`/`pollOnce` loop and the same deliveries as the account watcher, with
 * no change to either. That is the point of the generic `Notification<P>` core.
 *
 * State: the first poll baselines silently (snapshots the holder set, emits
 * nothing); later polls emit only real changes. In-memory by default — pass
 * `statePath` to persist the snapshot, and a restart diffs against the saved
 * baseline instead of silently re-baselining (balance changes that happened
 * while the process was down are then emitted, not swallowed).
 */
import { createMirrorNodeClient } from "@hiero-hackers/enterprise-mirror";
import type { Notification, Watcher } from "../types.js";
import { persistentMap } from "../state.js";
import { log } from "../log.js";

/**
 * The slice of the mirror client this watcher uses, described structurally —
 * the injection seam that makes the snapshot/diff logic testable without a
 * network. `createMirrorNodeClient(...)` satisfies it.
 */
export interface TokenMirror {
  queryTokenById(tokenId: string): Promise<{ symbol: string; decimals: number }>;
  queryTokenBalances(
    tokenId: string,
    query: { readonly limit?: number; readonly accountBalance?: { readonly gte: number } },
  ): Promise<TokenBalancePage>;
}

export interface TokenBalancePage {
  readonly data: readonly { readonly accountId: string; readonly balance: number | string }[];
  readonly next?: (() => Promise<TokenBalancePage>) | null;
}

/** One holder's balance change between two polls. `delta = after - before`. */
export interface TokenBalanceChange {
  readonly tokenId: string;
  /** Which network the token lives on — `0.0.x` ids exist on every network. */
  readonly network: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly account: string;
  readonly before: bigint;
  readonly after: bigint;
  readonly delta: bigint;
  /**
   * `changed` — a holder in both snapshots moved. `entered` — appeared in this
   * poll's set (from 0, or from below `minBalance` when a threshold is used).
   * `exited` — dropped out of the set (to 0, or below the threshold).
   */
  readonly reason: "changed" | "entered" | "exited";
}

export interface TokenWatcherOptions {
  readonly tokenId: string;
  /** "mainnet" (default), "testnet", … */
  readonly network?: string;
  /** Only track holders with at least this many *whole* tokens (a whale filter). */
  readonly minBalance?: number;
  /** Cap on holders tracked per poll (default 1000). If the set is larger it is
   *  truncated and a warning is logged — never silently. */
  readonly maxHolders?: number;
  /**
   * Path of a JSON snapshot file. When set, the holder baseline survives
   * restarts: the next run diffs against the saved snapshot and emits what
   * changed while the process was down, instead of re-baselining silently.
   */
  readonly statePath?: string;
  /** Injectable mirror client (tests). Default: a real client for `network`. */
  readonly mirror?: TokenMirror;
}

export function tokenBalanceWatcher(opts: TokenWatcherOptions): Watcher<TokenBalanceChange> {
  const network = opts.network ?? "mainnet";
  const mirror: TokenMirror = opts.mirror ?? createMirrorNodeClient({ network });
  const maxHolders = opts.maxHolders ?? 1000;
  let meta: { symbol: string; decimals: number } | undefined;
  // undefined until the first poll baselines — or seeded from the state file,
  // in which case the first poll after a restart CATCHES UP.
  const state = persistentMap(opts.statePath);
  let prev: Map<string, bigint> | undefined;
  if (state.entries.size > 0) {
    prev = new Map([...state.entries].map(([a, b]) => [a, BigInt(b)]));
  }
  const persist = (snapshot: ReadonlyMap<string, bigint>): void => {
    state.entries.clear();
    for (const [account, balance] of snapshot) state.entries.set(account, balance.toString());
    state.save(); // after assembly — see persistentMap's contract
  };

  return async () => {
    if (!meta) {
      const info = await mirror.queryTokenById(opts.tokenId);
      meta = { symbol: info.symbol || opts.tokenId, decimals: info.decimals };
    }
    const threshold =
      opts.minBalance !== undefined ? opts.minBalance * 10 ** meta.decimals : undefined;

    // Snapshot the current holder set (following pages up to maxHolders).
    const curr = new Map<string, bigint>();
    let page = await mirror.queryTokenBalances(opts.tokenId, {
      limit: 100,
      ...(threshold !== undefined ? { accountBalance: { gte: threshold } } : {}),
    });
    let capped = false;
    for (;;) {
      for (const holder of page.data) {
        if (curr.size >= maxHolders) {
          capped = true;
          break;
        }
        curr.set(holder.accountId, BigInt(holder.balance));
      }
      if (capped || !page.next) break;
      page = await page.next();
    }
    if (capped) {
      log(
        "holders-capped",
        { tokenId: opts.tokenId, maxHolders },
        `[token-balances ${opts.tokenId}] holder set exceeds maxHolders=${maxHolders}; tracking the first ${maxHolders} only`,
      );
    }

    // First poll: baseline silently — we have no "before" to compare against.
    if (!prev) {
      prev = curr;
      persist(curr);
      return [];
    }

    const at = new Date().toISOString();
    const out: Notification<TokenBalanceChange>[] = [];
    for (const change of diffHolders(prev, curr)) {
      out.push({
        id: `token-balances:${opts.tokenId}:${change.account}:${change.before}->${change.after}`,
        source: "token-balances",
        subject: `${opts.tokenId} · ${change.account}`,
        text: renderChange(change, meta.symbol, meta.decimals),
        at,
        payload: {
          tokenId: opts.tokenId,
          network,
          symbol: meta.symbol,
          decimals: meta.decimals,
          ...change,
        },
      });
    }
    prev = curr;
    persist(curr);
    return out;
  };
}

// ── Pure diff (unit-tested) ──────────────────────────────────────────────

/** Every holder whose balance differs between two snapshots. */
export function diffHolders(
  prev: ReadonlyMap<string, bigint>,
  curr: ReadonlyMap<string, bigint>,
): Array<Pick<TokenBalanceChange, "account" | "before" | "after" | "delta" | "reason">> {
  const changes: Array<
    Pick<TokenBalanceChange, "account" | "before" | "after" | "delta" | "reason">
  > = [];
  for (const [account, after] of curr) {
    const before = prev.get(account) ?? 0n;
    if (after !== before) {
      changes.push({
        account,
        before,
        after,
        delta: after - before,
        reason: prev.has(account) ? "changed" : "entered",
      });
    }
  }
  for (const [account, before] of prev) {
    if (!curr.has(account)) {
      changes.push({ account, before, after: 0n, delta: -before, reason: "exited" });
    }
  }
  return changes;
}

// ── Condition + rendering ────────────────────────────────────────────────

/** Notify only when |delta| is at least `whole` tokens (in whole units). */
export function tokenDeltaAtLeast(whole: number): {
  name: string;
  matches(p: TokenBalanceChange): boolean;
} {
  return {
    name: `token-delta>=${whole}`,
    matches: (p) => abs(p.delta) >= BigInt(Math.round(whole)) * 10n ** BigInt(p.decimals),
  };
}

function renderChange(
  c: Pick<TokenBalanceChange, "account" | "before" | "after" | "delta" | "reason">,
  symbol: string,
  decimals: number,
): string {
  const sign = c.delta >= 0n ? "+" : "−";
  const arrow =
    c.reason === "entered" ? " (new holder)" : c.reason === "exited" ? " (no longer holding)" : "";
  return `${symbol}: ${c.account} ${sign}${whole(abs(c.delta), decimals)}${arrow}  (${whole(c.before, decimals)} → ${whole(c.after, decimals)})`;
}

/** Whole-unit string for a non-negative smallest-unit amount (exact, bigint). */
function whole(amount: bigint, decimals: number): string {
  const a = abs(amount);
  if (decimals === 0) return a.toString();
  const base = 10n ** BigInt(decimals);
  const frac = (a % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${a / base}.${frac}` : `${a / base}`;
}

const abs = (n: bigint): bigint => (n < 0n ? -n : n);
