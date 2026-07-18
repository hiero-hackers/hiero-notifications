/**
 * The CLI flag layer — everything between `argv` and a `NotifyConfig`.
 * Separated from the config model on purpose: this file changes when the
 * CLI grows ergonomics; `config.ts` changes when the product grows a
 * capability.
 */
import type { DeliveriesConfig, NotifyConfig, Trigger } from "./config.js";

/**
 * THE flag table — single source of truth for every flag the CLI
 * understands. `KNOWN_FLAGS` (typo rejection) and `usage()` (the help text)
 * are both derived from it, and a test asserts the README documents every
 * entry — so adding a flag is ONE row here plus its `argsToConfig` mapping,
 * and nothing can drift silently.
 *
 * Typos must be ERRORS, not silently ignored no-ops: an operator who
 * mistyped `--state` believes they have crash-safe cursors when they do not.
 */
export interface FlagSpec {
  readonly name: string;
  /** Metavar for a valued flag (`"FILE"`); absent = boolean flag. */
  readonly value?: string;
  readonly help: string;
}

export const FLAG_SPECS: readonly FlagSpec[] = [
  { name: "config", value: "FILE", help: "load a NotifyConfig JSON file (declarative setup)" },
  { name: "webhook", value: "URL", help: "POST each notification as JSON" },
  { name: "slack", value: "URL", help: "Slack incoming-webhook delivery" },
  { name: "discord", value: "URL", help: "Discord incoming-webhook delivery" },
  { name: "min-inflow", value: "H", help: "trigger: net inflow of at least H ℏ" },
  { name: "min-outflow", value: "H", help: "trigger: net outflow of at least H ℏ" },
  { name: "staking", help: "trigger: a staking reward was paid" },
  { name: "state", value: "FILE", help: "persist cursors — restarts catch up, not re-baseline" },
  { name: "dead-letter", value: "FILE", help: "keep finally-failed deliveries for --replay" },
  { name: "replay", value: "FILE", help: "re-deliver a dead-letter file, then exit" },
  { name: "type", value: "TYPE", help: "one mirror transaction type (default: all)" },
  { name: "network", value: "NAME", help: 'mirror network (default: "mainnet")' },
  { name: "interval", value: "SECONDS", help: "poll interval (default: 15)" },
  { name: "backfill", value: "N", help: "recent matches emitted on first sight (default: 1)" },
  { name: "once", help: "poll once and exit" },
  { name: "json", help: "structured JSON-line logs on stderr" },
];

export const KNOWN_FLAGS: ReadonlySet<string> = new Set(FLAG_SPECS.map((f) => f.name));

/** The help text, rendered from {@link FLAG_SPECS}. */
export function usage(): string {
  const flagLines = FLAG_SPECS.map((f) => {
    const left = `--${f.name}${f.value ? ` ${f.value}` : ""}`;
    return `  ${left.padEnd(22)}${f.help}`;
  }).join("\n");
  return `usage:
  hiero-notify --config FILE                  declarative (recommended)
  hiero-notify <account...> [flags]           quick one-off
  hiero-notify --replay FILE [delivery flags] re-deliver a dead-letter file

flags:
${flagLines}`;
}

export interface Args {
  readonly accounts: string[];
  /** Every `--flag` seen, for unknown-flag rejection. */
  readonly keys: readonly string[];
  flag(key: string): string | undefined;
  bool(key: string): boolean;
  num(key: string): number | undefined;
}

export function parseArgs(argv: readonly string[]): Args {
  const accounts: string[] = [];
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- i is a loop counter into an array, not a user-controlled property name
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
    keys: [...new Set([...flags.keys(), ...bools])],
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
    ...(args.flag("state") ? { state: args.flag("state")! } : {}),
    ...(args.flag("dead-letter") ? { deadLetter: args.flag("dead-letter")! } : {}),
    ...(args.flag("type") ? { transactionType: args.flag("type")! } : {}),
    ...(triggers.length > 0 ? { triggers } : {}),
    deliveries,
  };
}
