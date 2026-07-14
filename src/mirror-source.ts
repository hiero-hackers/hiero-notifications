/**
 * The mirror-backed `Source` — the one piece that touches the network. It
 * polls `@hiero-enterprise/mirror` for each tracked account, turns new
 * transactions into receipts with `hiero-receipts`, and remembers how far it
 * got (in memory). This is where the two ecosystem packages are imported, so
 * the rest of the app (and its tests) stays free of them.
 *
 * State is in-memory: a restart re-baselines and does not re-notify history.
 */
import { createMirrorNodeClient } from "@hiero-enterprise/mirror";
import { receiptFor } from "hiero-receipts";
import { fromMirror } from "hiero-receipts/mirror";
import { usdPriceFromExchangeRate } from "hiero-receipts/exchange-rate";
import type { AccountReceipt, Source } from "./types.js";

export interface MirrorSourceOptions {
  readonly accounts: readonly string[];
  /** "mainnet" (default), "testnet", … */
  readonly network?: string;
  /** On an account's first poll, emit this many recent matches (default 1) so
   *  you get immediate feedback without a flood of history. */
  readonly backfill?: number;
  /** Page size per account per poll (default 25). */
  readonly limit?: number;
}

export function mirrorSource(opts: MirrorSourceOptions): Source {
  const mirror = createMirrorNodeClient({ network: opts.network ?? "mainnet" });
  const seen = new Map<string, string>(); // account → newest consensusTimestamp emitted

  return async () => {
    const { currentRate } = await mirror.queryExchangeRates();
    const prices = usdPriceFromExchangeRate(currentRate);
    const out: AccountReceipt[] = [];

    for (const account of opts.accounts) {
      const since = seen.get(account);
      const page = await mirror.queryTransactionsByAccount(account, {
        transactionType: "CRYPTOTRANSFER",
        limit: opts.limit ?? 25,
        order: "desc",
        ...(since ? { timestamp: { gt: since } } : {}),
      });
      if (!page.data.length) continue;

      seen.set(account, page.data[0]!.consensusTimestamp); // advance to the newest
      // First time seeing this account: emit only the N most recent (baseline).
      const chosen = since ? page.data : page.data.slice(0, opts.backfill ?? 1);
      for (const tx of [...chosen].reverse()) {
        // oldest-first, so notifications arrive in chronological order
        out.push({ account, receipt: receiptFor(account, fromMirror(tx), { prices }) });
      }
    }
    return out;
  };
}
