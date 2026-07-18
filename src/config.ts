/**
 * Configuration — one canonical `NotifyConfig` that can come from a JSON file
 * (`--config`) *or* be built from CLI flags. Both resolve through the same
 * `conditionFor` / `deliveriesFor`, so the two input paths can't drift.
 */
import { readFileSync } from "node:fs";
import type { Condition, Delivery } from "./types.js";
import { anyActivity, anyOf } from "./condition.js";
import {
  anyBalanceChange,
  inflowAtLeast,
  outflowAtLeast,
  stakingReward,
} from "./watchers/account.js";
import { consoleDelivery, webhookDelivery, slackDelivery, discordDelivery } from "./delivery.js";

/** A notification trigger — what makes a transaction worth notifying about. */
export type Trigger =
  | { type: "any" }
  | { type: "balance-change" }
  | { type: "staking" }
  | { type: "inflow"; minHbar: number }
  | { type: "outflow"; minHbar: number };

/** A delivery channel: a bare URL, or `{ url, enabled }` so it can be toggled
 *  off without deleting the URL. */
export type Channel = string | { url: string; enabled?: boolean };

export interface DeliveriesConfig {
  console?: boolean; // default true
  webhook?: Channel;
  slack?: Channel;
  discord?: Channel;
}

export interface NotifyConfig {
  accounts: string[];
  network?: string; // default "mainnet"
  pollIntervalSeconds?: number; // default 15
  backfill?: number; // default 1
  state?: string; // cursor file path — set it and restarts catch up instead of re-baselining
  deadLetter?: string; // append finally-failed deliveries here (one JSON line each) for replay
  transactionType?: string; // restrict to one mirror type (default: all — receipts speak every type)
  triggers?: Trigger[]; // default [{ type: "balance-change" }]
  deliveries?: DeliveriesConfig; // default console only
}

// ── Resolving a config into runnable pieces ──────────────────────────────

/** The condition: each trigger becomes a `Condition`, combined with OR. */
export function conditionFor(config: NotifyConfig): Condition {
  const triggers = config.triggers?.length
    ? config.triggers
    : [{ type: "balance-change" } as const];
  const conditions = triggers.map(triggerToCondition);
  return conditions.length === 1 ? conditions[0]! : anyOf(...conditions);
}

/** The enabled delivery channels. Console is on unless explicitly `false`. */
export function deliveriesFor(config: NotifyConfig): Delivery[] {
  const d = config.deliveries ?? {};
  const deliveries: Delivery[] = [];
  if (d.console !== false) deliveries.push(consoleDelivery);
  const webhook = channelUrl(d.webhook);
  if (webhook) deliveries.push(webhookDelivery(webhook));
  const slack = channelUrl(d.slack);
  if (slack) deliveries.push(slackDelivery(slack));
  const discord = channelUrl(d.discord);
  if (discord) deliveries.push(discordDelivery(discord));
  return deliveries;
}

export function pollIntervalMs(config: NotifyConfig): number {
  return (config.pollIntervalSeconds ?? 15) * 1000;
}

function triggerToCondition(trigger: Trigger): Condition {
  switch (trigger.type) {
    case "any":
      return anyActivity;
    case "balance-change":
      return anyBalanceChange;
    case "staking":
      return stakingReward;
    case "inflow":
      return inflowAtLeast(trigger.minHbar);
    case "outflow":
      return outflowAtLeast(trigger.minHbar);
  }
}

const KNOWN_CONFIG_KEYS = new Set([
  "accounts",
  "network",
  "pollIntervalSeconds",
  "backfill",
  "state",
  "deadLetter",
  "transactionType",
  "triggers",
  "deliveries",
]);

/** Split argv into accounts, valued flags (`--k v`), and boolean flags (`--k`). */

/** A channel's URL, or `undefined` when absent or explicitly disabled. */
function channelUrl(channel?: Channel): string | undefined {
  if (!channel) return undefined;
  if (typeof channel === "string") return channel;
  return channel.enabled === false ? undefined : channel.url;
}

// ── Loading a config from a JSON file ────────────────────────────────────

export function loadConfig(path: string): NotifyConfig {
  let raw: unknown;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- reading the user's own --config path is this function's purpose
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`could not read config ${path}: ${err instanceof Error ? err.message : err}`, {
      cause: err,
    });
  }
  const config = raw as NotifyConfig;
  // A typo'd key silently falling back to a default is the config-file
  // version of a mistyped flag — reject it with the exact names.
  const unknown = Object.keys(config).filter((k) => !KNOWN_CONFIG_KEYS.has(k));
  if (unknown.length > 0) {
    throw new Error(`config ${path}: unknown key(s): ${unknown.join(", ")}`);
  }
  if (!Array.isArray(config.accounts) || config.accounts.length === 0) {
    throw new Error(`config ${path}: "accounts" must be a non-empty array`);
  }
  return config;
}

// ── Building a config from CLI flags ─────────────────────────────────────
