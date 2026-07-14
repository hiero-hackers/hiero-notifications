/**
 * Programmatic usage — how you'd extend the watcher in your own app, with a
 * CUSTOM condition and a CUSTOM delivery alongside the built-ins.
 *
 *   node examples/custom-watch.ts [account]     (default 0.0.98)
 *
 * Does one poll and exits. Needs the workspace deps installed and the library
 * built (`npm install && npm run build`).
 */
import { appendFileSync } from "node:fs";
import { pollOnce, mirrorSource, consoleDelivery, anyOf, anyBalanceChange } from "../dist/index.js";
import type { Condition, Delivery } from "../dist/index.js";

// ── A custom CONDITION: notify on any NFT sent or received. ──
const nftActivity: Condition = {
  name: "nft-activity",
  matches: (receipt) => (receipt.nft?.length ?? 0) > 0,
};

// ── A custom DELIVERY: append each receipt to a JSONL file (bigints as
//    strings, so nothing is lost). This is all a "delivery" is. ──
const toFile: Delivery = {
  name: "file(receipts.jsonl)",
  async deliver(event) {
    const line = JSON.stringify(
      { account: event.account, at: event.at, receipt: event.receipt },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    );
    appendFileSync("receipts.jsonl", line + "\n");
  },
};

const account = process.argv[2] ?? "0.0.98";

const delivered = await pollOnce({
  source: mirrorSource({ accounts: [account] }),
  // A built-in composed with the custom one: any balance change OR NFT activity.
  condition: anyOf(anyBalanceChange, nftActivity),
  deliveries: [consoleDelivery, toFile],
});

console.error(`\n${delivered} notification(s) delivered (console + receipts.jsonl).`);
