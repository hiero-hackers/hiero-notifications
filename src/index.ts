/**
 * hiero-notifications — a small framework to **watch Hedera activity and
 * deliver a notification when something matters**. A `Watcher` produces
 * notifications, a `Condition` decides which ones matter, and a `Delivery`
 * sends them (console / webhook / Slack / Discord, or your own).
 *
 * The built-in watcher is **account activity**, which delivers a
 * provenance-stamped receipt (via
 * [`@hiero-hackers/hiero-receipts`](https://github.com/hiero-hackers/hiero-receipts)) when a
 * tracked account transacts. Other watchers plug into the same loop — see
 * `examples/topic-watcher.ts`.
 *
 *   import {
 *     watch, accountWatcher, consoleDelivery, webhookDelivery, inflowAtLeast,
 *   } from "@hiero-hackers/hiero-notifications";
 *
 *   await watch({
 *     watcher: accountWatcher({
 *       accounts: ["0.0.1234"],
 *       statePath: ".state.json",                     // restarts catch up, not re-baseline
 *     }),
 *     condition: inflowAtLeast(100),                  // notify on inflow ≥ 100 ℏ
 *     deliveries: [consoleDelivery, webhookDelivery("https://example.com/hook")],
 *     deadLetterPath: "dead.jsonl",                   // failed deliveries kept for --replay
 *   });
 *
 * Delivery is at-least-once — consumers dedupe on `Notification.id`.
 */
export { watch, pollOnce } from "./watcher.js";
export type { WatchOptions } from "./watcher.js";
export {
  accountWatcher,
  anyBalanceChange,
  stakingReward,
  inflowAtLeast,
  outflowAtLeast,
} from "./watchers/account.js";
export type { AccountWatcherOptions, AccountMirror } from "./watchers/account.js";
export { tokenBalanceWatcher, tokenDeltaAtLeast, diffHolders } from "./watchers/token.js";
export type {
  TokenWatcherOptions,
  TokenBalanceChange,
  TokenMirror,
  TokenBalancePage,
} from "./watchers/token.js";
export { replayDeadLetters } from "./replay.js";
export type { ReplayResult } from "./replay.js";
export { setJsonLogs } from "./log.js";
export { consoleDelivery, webhookDelivery, slackDelivery, discordDelivery } from "./delivery.js";
export type { WebhookOptions } from "./delivery.js";
export { anyActivity, anyOf, allOf } from "./condition.js";
export type { Condition, Delivery, Watcher, Notification } from "./types.js";
/** Re-exported for typing account-watcher conditions: `Condition<Receipt>`. */
export type { Receipt } from "@hiero-hackers/hiero-receipts";

export { loadConfig, conditionFor, deliveriesFor, pollIntervalMs } from "./config.js";
export type { NotifyConfig, Trigger, Channel, DeliveriesConfig } from "./config.js";
