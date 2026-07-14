/**
 * Configuration — one canonical `NotifyConfig` that can come from a JSON file
 * (`--config`) *or* be built from CLI flags. Both resolve through the same
 * `conditionFor` / `deliveriesFor`, so the two input paths can't drift.
 */
import { readFileSync } from "node:fs";
import type { Condition, Delivery } from "./types.js";
import { anyBalanceChange, anyOf, anyTransaction, inflowAtLeast, outflowAtLeast, stakingReward } from "./condition.js";
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
  triggers?: Trigger[]; // default [{ type: "balance-change" }]
  deliveries?: DeliveriesConfig; // default console only
}

// ── Resolving a config into runnable pieces ──────────────────────────────

/** The condition: each trigger becomes a `Condition`, combined with OR. */
export function conditionFor(config: NotifyConfig): Condition {
  const triggers = config.triggers?.length ? config.triggers : [{ type: "balance-change" } as const];
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
      return anyTransaction;
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
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`could not read config ${path}: ${err instanceof Error ? err.message : err}`);
  }
  const config = raw as NotifyConfig;
  if (!Array.isArray(config.accounts) || config.accounts.length === 0) {
    throw new Error(`config ${path}: "accounts" must be a non-empty array`);
  }
  return config;
}

// ── Building a config from CLI flags ─────────────────────────────────────

export interface Args {
  readonly accounts: string[];
  flag(key: string): string | undefined;
  bool(key: string): boolean;
  num(key: string): number | undefined;
}

/** Split argv into accounts, valued flags (`--k v`), and boolean flags (`--k`). */
export function parseArgs(argv: readonly string[]): Args {
  const accounts: string[] = [];
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      accounts.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      bools.add(key);
    }
  }
  return {
    accounts,
    flag: (key) => flags.get(key),
    bool: (key) => bools.has(key),
    num: (key) => (flags.has(key) ? Number(flags.get(key)) : undefined),
  };
}

export function argsToConfig(args: Args): NotifyConfig {
  const triggers: Trigger[] = [];
  if (args.bool("staking")) triggers.push({ type: "staking" });
  const inflow = args.num("min-inflow");
  if (inflow !== undefined) triggers.push({ type: "inflow", minHbar: inflow });
  const outflow = args.num("min-outflow");
  if (outflow !== undefined) triggers.push({ type: "outflow", minHbar: outflow });

  const deliveries: DeliveriesConfig = {};
  const webhook = args.flag("webhook");
  if (webhook) deliveries.webhook = webhook;
  const slack = args.flag("slack");
  if (slack) deliveries.slack = slack;
  const discord = args.flag("discord");
  if (discord) deliveries.discord = discord;

  return {
    accounts: args.accounts,
    ...(args.flag("network") ? { network: args.flag("network")! } : {}),
    ...(args.num("interval") !== undefined ? { pollIntervalSeconds: args.num("interval")! } : {}),
    ...(args.num("backfill") !== undefined ? { backfill: args.num("backfill")! } : {}),
    ...(triggers.length > 0 ? { triggers } : {}),
    deliveries,
  };
}
