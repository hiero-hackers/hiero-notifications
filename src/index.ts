/**
 * hiero-account-notifications — watch Hedera accounts and deliver a
 * provenance-stamped receipt when they transact. The app tier over
 * [`hiero-receipts`](https://github.com/hiero-hackers/hiero-receipts).
 *
 * Wire it up in code:
 *
 *   import { watchAccounts, mirrorSource, consoleDelivery, webhookDelivery, inflowAtLeast } from "hiero-account-notifications";
 *
 *   await watchAccounts({
 *     source: mirrorSource({ accounts: ["0.0.1234"] }),
 *     condition: inflowAtLeast(100),                 // notify on inflow ≥ 100 ℏ
 *     deliveries: [consoleDelivery, webhookDelivery("https://example.com/hook")],
 *   });
 */
export { watchAccounts, pollOnce } from "./watcher.js";
export type { WatchOptions } from "./watcher.js";
export { mirrorSource } from "./mirror-source.js";
export type { MirrorSourceOptions } from "./mirror-source.js";
export { consoleDelivery, webhookDelivery, slackDelivery, discordDelivery } from "./delivery.js";
export type { WebhookOptions } from "./delivery.js";
export {
  anyTransaction,
  anyBalanceChange,
  stakingReward,
  inflowAtLeast,
  outflowAtLeast,
  anyOf,
  allOf,
} from "./condition.js";
export type { Condition, Delivery, Source, NotificationEvent, AccountReceipt } from "./types.js";

export { loadConfig, conditionFor, deliveriesFor, pollIntervalMs } from "./config.js";
export type { NotifyConfig, Trigger, Channel, DeliveriesConfig } from "./config.js";
