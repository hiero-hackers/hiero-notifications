/**
 * The account watcher's paging semantics, through the injectable mirror seam
 * — the guarantee under test: an account that outpaces the poll interval
 * NEVER loses notifications. Deep backlogs are walked oldest-first across
 * pages; the per-poll cap defers work to the next poll instead of dropping
 * it (the pre-fix behavior kept only the newest page and jumped the cursor
 * past everything else).
 */
import { describe, expect, it } from "vitest";
import { accountWatcher, type AccountMirror } from "../../src/watchers/account.js";
import type { TransactionInfoLike } from "@hiero-hackers/hiero-receipts/mirror";

const ACCOUNT = "0.0.7001";

const tx = (i: number): TransactionInfoLike => ({
  transactionId: `${ACCOUNT}-${1000 + i}-000000000`,
  name: "CRYPTOTRANSFER",
  result: "SUCCESS",
  consensusTimestamp: `${1000 + i}.000000000`,
  chargedTxFee: "100",
  transfers: [
    { accountId: ACCOUNT, amount: "-1000100" },
    { accountId: "0.0.8891", amount: "1000000" },
  ],
  tokenTransfers: [],
});

/** An in-memory mirror over `all` (ascending), honoring order/limit/gt. */
const fakeMirror = (all: TransactionInfoLike[]): AccountMirror => ({
  async queryExchangeRates() {
    return { currentRate: { hbarEquivalent: 30000, centEquivalent: 174000 } };
  },
  async queryTransactionsByAccount(_account, query) {
    let data = [...all];
    if (query.timestamp?.gt !== undefined) {
      const gt = query.timestamp.gt;
      data = data.filter((t) => t.consensusTimestamp > gt);
    }
    if (query.order === "desc") data = data.reverse();
    return { data: data.slice(0, query.limit ?? 25) };
  },
});

const timestamps = (notifications: readonly { payload: { consensusTimestamp: string } }[]) =>
  notifications.map((n) => n.payload.consensusTimestamp);

describe("account watcher paging", () => {
  it("baseline poll emits only the backfill count, oldest-first", async () => {
    const watcher = accountWatcher({
      accounts: [ACCOUNT],
      backfill: 2,
      mirror: fakeMirror([tx(1), tx(2), tx(3)]),
    });
    const first = await watcher();
    expect(timestamps(first)).toEqual(["1002.000000000", "1003.000000000"]);
  });

  it("a backlog deeper than one page is walked in full, chronologically", async () => {
    const all = Array.from({ length: 61 }, (_, i) => tx(i));
    const watcher = accountWatcher({
      accounts: [ACCOUNT],
      limit: 25,
      mirror: fakeMirror(all),
    });
    await watcher(); // baseline on tx(60)
    all.push(...Array.from({ length: 60 }, (_, i) => tx(61 + i))); // 60 new txs land
    const caughtUp = await watcher();
    expect(caughtUp).toHaveLength(60); // pre-fix: only 25, rest silently lost
    expect(timestamps(caughtUp)).toEqual(
      Array.from({ length: 60 }, (_, i) => `${1061 + i}.000000000`),
    );
  });

  it("the per-poll cap defers — the remainder arrives next poll, nothing lost", async () => {
    const all = [tx(0)];
    const watcher = accountWatcher({
      accounts: [ACCOUNT],
      limit: 25,
      maxCatchUpPerPoll: 30,
      mirror: fakeMirror(all),
    });
    await watcher(); // baseline on tx(0)
    all.push(...Array.from({ length: 50 }, (_, i) => tx(1 + i)));
    const poll1 = await watcher();
    const poll2 = await watcher();
    expect(poll1).toHaveLength(30);
    expect(poll2).toHaveLength(20);
    expect([...timestamps(poll1), ...timestamps(poll2)]).toEqual(
      Array.from({ length: 50 }, (_, i) => `${1001 + i}.000000000`),
    );
  });

  it("a quiet account emits nothing and keeps its cursor", async () => {
    const watcher = accountWatcher({
      accounts: [ACCOUNT],
      mirror: fakeMirror([tx(1)]),
    });
    await watcher();
    expect(await watcher()).toHaveLength(0);
    expect(await watcher()).toHaveLength(0);
  });
});

describe("network and type filter (audit #3)", () => {
  it("receipts name the network in their provenance", async () => {
    const watcher = accountWatcher({
      accounts: [ACCOUNT],
      network: "testnet",
      mirror: fakeMirror([tx(1)]),
    });
    const [n] = await watcher();
    expect(n!.payload.provenance.network).toBe("testnet");
    expect(n!.text).toContain("From the testnet mirror node");
  });

  it("no type filter by default; an explicit one is passed through", async () => {
    const queries: Array<string | undefined> = [];
    const recording = (all: TransactionInfoLike[]): AccountMirror => {
      const inner = fakeMirror(all);
      return {
        queryExchangeRates: () => inner.queryExchangeRates(),
        queryTransactionsByAccount(account, query) {
          queries.push(query.transactionType);
          return inner.queryTransactionsByAccount(account, query);
        },
      };
    };
    await accountWatcher({ accounts: [ACCOUNT], mirror: recording([tx(1)]) })();
    await accountWatcher({
      accounts: [ACCOUNT],
      transactionType: "CRYPTOTRANSFER",
      mirror: recording([tx(1)]),
    })();
    expect(queries).toEqual([undefined, "CRYPTOTRANSFER"]);
  });
});
