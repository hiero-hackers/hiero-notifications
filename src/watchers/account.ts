/**
 * The account-activity watcher — **account transactions → receipt notifications**,
 * and the receipt-specific conditions that go with it.
 *
 * This is the one watcher that uses `@hiero-hackers/hiero-receipts`: it turns each new
 * transaction into a provenance-stamped receipt (fee decomposition, movements,
 * staking rewards, real USD valuation at the transaction's timestamp) and
 * renders it. It's also the one file that imports `@hiero-hackers/enterprise-mirror` for
 * account data, so the rest of the framework stays free of both packages.
 *
 * Self-contained on purpose: the watcher, its payload type (`Receipt`), and the
 * predicates over that payload all live here — the template for adding a watcher.
 *
 * State: in-memory by default (a restart re-baselines). Pass `statePath` to
 * persist cursors to a JSON file after every poll — then a restart CATCHES
 * UP from the last notified transaction instead of silently swallowing
 * whatever happened while the process was down. See `state.ts`.
 */
import { createMirrorNodeClient } from "@hiero-hackers/enterprise-mirror";
import type { TransactionType } from "@hiero-hackers/enterprise-mirror";
import { receiptFor, toHTML, toText } from "@hiero-hackers/hiero-receipts";
import type { Receipt } from "@hiero-hackers/hiero-receipts";
import { fromMirror } from "@hiero-hackers/hiero-receipts/mirror";
import type { TransactionInfoLike } from "@hiero-hackers/hiero-receipts/mirror";
import { usdPriceFromExchangeRate } from "@hiero-hackers/hiero-receipts/exchange-rate";
import type { ExchangeRateLike } from "@hiero-hackers/hiero-receipts/exchange-rate";
import type { Condition, Notification, Watcher } from "../types.js";
import { persistentMap } from "../state.js";
import { log } from "../log.js";

/**
 * The slice of the mirror client this watcher uses, described structurally —
 * the injection seam that makes the paging logic testable without a network.
 * `createMirrorNodeClient(...)` satisfies it.
 */
export interface AccountMirror {
  queryExchangeRates(): Promise<{ currentRate: ExchangeRateLike }>;
  queryTransactionsByAccount(
    accountId: string,
    query: {
      readonly transactionType?: TransactionType;
      readonly limit?: number;
      readonly order?: "asc" | "desc";
      readonly timestamp?: { readonly gt: string };
    },
  ): Promise<{ data: readonly TransactionInfoLike[] }>;
}

export interface AccountWatcherOptions {
  readonly accounts: readonly string[];
  /** "mainnet" (default), "testnet", … */
  readonly network?: string;
  /** On an account's first poll, emit this many recent matches (default 1) so
   *  you get immediate feedback without a flood of history. */
  readonly backfill?: number;
  /** Page size per account per poll (default 25). */
  readonly limit?: number;
  /**
   * Restrict to one mirror transaction type (e.g. `"CRYPTOTRANSFER"`).
   * Default: ALL types — receipts speak every type ("You called a smart
   * contract", "You submitted a message to a topic", …), so the watcher
   * no longer silently ignores everything that isn't a bare transfer.
   */
  readonly transactionType?: TransactionType;
  /**
   * Path of a JSON cursor file. When set, cursors survive restarts: the
   * watcher resumes from the last notified transaction per account
   * (`backfill` then only applies to accounts the file has never seen).
   */
  readonly statePath?: string;
  /**
   * Per-account cap on catch-up work in a single poll (default 250). The cap
   * bounds a poll, it never loses events: the cursor only advances through
   * what was emitted, so a deeper backlog simply continues next poll.
   */
  readonly maxCatchUpPerPoll?: number;
  /** Injectable mirror client (tests). Default: a real client for `network`. */
  readonly mirror?: AccountMirror;
}

export function accountWatcher(opts: AccountWatcherOptions): Watcher<Receipt> {
  const network = opts.network ?? "mainnet";
  const mirror: AccountMirror = opts.mirror ?? createMirrorNodeClient({ network });
  const pageSize = opts.limit ?? 25;
  const catchUpCap = opts.maxCatchUpPerPoll ?? 250;
  const typeFilter =
    opts.transactionType !== undefined ? { transactionType: opts.transactionType } : {};
  // account → newest consensusTimestamp emitted; seeded from the state file
  // when one is configured, so a restart resumes instead of re-baselining.
  const state = persistentMap(opts.statePath);
  const seen = state.entries;

  return async () => {
    const { currentRate } = await mirror.queryExchangeRates();
    const prices = usdPriceFromExchangeRate(currentRate);
    const at = new Date().toISOString();
    const out: Notification<Receipt>[] = [];

    const emit = (account: string, tx: TransactionInfoLike): void => {
      // Naming the network matters: 0.0.1234 exists on every network, and
      // the receipt's provenance line renders it ("the mainnet mirror node").
      const receipt = receiptFor(account, fromMirror(tx, { network }), { prices });
      out.push({
        id: `account-activity:${account}:${tx.transactionId}`,
        source: "account-activity",
        subject: account,
        text: toText(receipt),
        html: toHTML(receipt),
        at,
        payload: receipt,
      });
    };

    let advanced = false;
    for (const account of opts.accounts) {
      const since = seen.get(account);

      if (since === undefined) {
        // First time seeing this account: baseline on the N most recent.
        const page = await mirror.queryTransactionsByAccount(account, {
          ...typeFilter,
          limit: pageSize,
          order: "desc",
        });
        if (!page.data.length) continue;
        seen.set(account, page.data[0]!.consensusTimestamp);
        advanced = true;
        for (const tx of [...page.data.slice(0, opts.backfill ?? 1)].reverse()) {
          emit(account, tx); // oldest-first, chronological delivery
        }
        continue;
      }

      // Catch-up: walk FORWARD from the cursor, keyset-style, oldest-first.
      // The cursor advances only through transactions actually emitted, so a
      // backlog deeper than the per-poll cap is deferred, never dropped —
      // the old newest-page-only approach silently lost anything beyond one
      // page whenever an account outpaced the poll interval.
      let cursor = since;
      let fetched = 0;
      while (fetched < catchUpCap) {
        const page = await mirror.queryTransactionsByAccount(account, {
          ...typeFilter,
          limit: Math.min(pageSize, catchUpCap - fetched),
          order: "asc",
          timestamp: { gt: cursor },
        });
        if (!page.data.length) break;
        for (const tx of page.data) {
          emit(account, tx);
          cursor = tx.consensusTimestamp;
        }
        fetched += page.data.length;
        seen.set(account, cursor);
        advanced = true;
        if (page.data.length < pageSize) break; // caught up
      }
      if (fetched >= catchUpCap) {
        log(
          "catch-up-capped",
          { account, cap: catchUpCap },
          `[${account}] catch-up capped at ${catchUpCap} this poll — continuing next poll`,
        );
      }
    }
    if (advanced) state.save(); // after assembly — see persistentMap's contract
    return out;
  };
}

// ── Conditions over a receipt payload ────────────────────────────────────

/** Any actual balance change (HBAR, token, or NFT) — skips no-op transactions. */
export const anyBalanceChange: Condition<Receipt> = {
  name: "balance-change",
  matches: (r) => r.movements.length > 0 || (r.nft?.length ?? 0) > 0,
};

/** A staking reward was paid to the account. */
export const stakingReward: Condition<Receipt> = {
  name: "staking-reward",
  matches: (r) => (r.stakingRewardTinybar ?? 0n) > 0n,
};

/** Net HBAR received is at least `hbar`. */
export function inflowAtLeast(hbar: number): Condition<Receipt> {
  const min = toTinybar(hbar);
  return { name: `inflow>=${hbar}h`, matches: (r) => hbarNet(r) >= min };
}

/** Net HBAR sent is at least `hbar`. */
export function outflowAtLeast(hbar: number): Condition<Receipt> {
  const min = toTinybar(hbar);
  return { name: `outflow>=${hbar}h`, matches: (r) => -hbarNet(r) >= min };
}

const hbarNet = (r: Receipt): bigint => r.movements.find((m) => m.kind === "hbar")?.amount ?? 0n;
const toTinybar = (hbar: number): bigint => BigInt(Math.round(hbar * 100_000_000));
