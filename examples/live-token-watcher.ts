/**
 * LIVE token-balance watcher — the real built-in, against mainnet.
 *
 *   node examples/live-token-watcher.ts [tokenId] [minWholeTokens]
 *   node examples/live-token-watcher.ts 0.0.456858 100      # USDC whales (≥100)
 *
 * Polls the token's holders via `@hiero-hackers/enterprise-mirror`; the first poll
 * baselines silently, then every subsequent poll prints each holding that
 * changed, with the exact before → after delta. Ctrl-C to stop. Needs the
 * workspace deps installed and the library built (`npm install && npm run build`).
 *
 * Note: this hits the public mainnet mirror node. A large token has many
 * holders — pass a `minWholeTokens` threshold to keep the tracked set small.
 */
import {
  watch,
  tokenBalanceWatcher,
  tokenDeltaAtLeast,
  consoleDelivery,
} from "@hiero-hackers/hiero-notifications";

const tokenId = process.argv[2] ?? "0.0.456858"; // USDC on Hedera mainnet
const minWhole = process.argv[3] ? Number(process.argv[3]) : 100_000;

console.error(
  `watching token ${tokenId} holders ≥ ${minWhole.toLocaleString()} whole tokens — first poll baselines, Ctrl-C to stop
(if nothing ever prints: no tracked holder has moved a whole token yet — lower the threshold, or check the token id)`,
);

const controller = new AbortController();
process.on("SIGINT", () => {
  console.error("\nstopping…");
  controller.abort();
});

await watch({
  watcher: tokenBalanceWatcher({ tokenId, minBalance: minWhole }),
  condition: tokenDeltaAtLeast(1), // ignore dust; any whole-token move of a tracked holder
  deliveries: [consoleDelivery],
  pollIntervalMs: 15_000,
  signal: controller.signal,
});
