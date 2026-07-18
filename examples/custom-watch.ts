/**
 * Programmatic usage — how you'd extend the built-in account watcher with a
 * CUSTOM condition and a CUSTOM delivery alongside the built-ins.
 *
 *   node examples/custom-watch.ts [account]     (default 0.0.98)
 *
 * Does one poll and exits. Needs the workspace deps installed and the library
 * built (`npm install && npm run build`).
 */
import { appendFileSync } from "node:fs";
import {
  pollOnce,
  accountWatcher,
  consoleDelivery,
  anyOf,
  anyBalanceChange,
} from "@hiero-hackers/hiero-notifications";
import type { Condition, Delivery, Receipt } from "@hiero-hackers/hiero-notifications";

// ── A custom CONDITION over the receipt payload: notify on any NFT moved. ──
const nftActivity: Condition<Receipt> = {
  name: "nft-activity",
  matches: (receipt) => (receipt.nft?.length ?? 0) > 0,
};

// ── A custom DELIVERY: append each notification to a JSONL file (bigints as
//    strings, so nothing is lost). This is all a "delivery" is — the same
//    shape serves email, Telegram, SMS, anything: do the I/O in deliver(),
//    and THROW on failure (e.g. a non-2xx API response) so the watch loop's
//    retry + dead-letter machinery handles it like any built-in channel. ──
const toFile: Delivery = {
  name: "file(receipts.jsonl)",
  async deliver(n) {
    const line = JSON.stringify(
      { id: n.id, source: n.source, subject: n.subject, at: n.at, payload: n.payload },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    );
    appendFileSync("receipts.jsonl", line + "\n");
  },
};

const account = process.argv[2] ?? "0.0.98";

const delivered = await pollOnce({
  watcher: accountWatcher({ accounts: [account] }),
  // A built-in composed with the custom one: any balance change OR NFT activity.
  condition: anyOf(anyBalanceChange, nftActivity),
  deliveries: [consoleDelivery, toFile],
});

console.error(`\n${delivered} notification(s) delivered (console + receipts.jsonl).`);
