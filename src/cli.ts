#!/usr/bin/env node
/**
 * hiero-notify — watch Hedera accounts and print / POST a receipt when they
 * transact. Configure it two ways:
 *
 *   hiero-notify --config notify.config.json          (declarative — recommended)
 *   hiero-notify <account...> [flags]                 (quick one-off)
 *
 * Flags:
 *   --webhook URL   --slack URL   --discord URL
 *   --min-inflow H  --min-outflow H  --staking
 *   --once  --interval SECONDS  --backfill N  --network NAME
 *   --state FILE    (persist cursors — restarts catch up instead of re-baselining)
 *   --type TYPE     (restrict to one mirror type, e.g. CRYPTOTRANSFER; default: all)
 *   --dead-letter FILE  (append finally-failed deliveries as JSON lines, for replay)
 *   --json          (structured JSON-line logs on stderr, for shipping/alerting)
 *   --replay FILE   (re-deliver a dead-letter file to the configured channels, then exit)
 */
import { pollOnce, watch } from "./watcher.js";
import { accountWatcher } from "./watchers/account.js";
import { loadConfig, conditionFor, deliveriesFor, pollIntervalMs } from "./config.js";
import { parseArgs, argsToConfig, KNOWN_FLAGS, usage } from "./flags.js";
import type { NotifyConfig } from "./config.js";
import type { TransactionType } from "@hiero-hackers/enterprise-mirror";
import { log, setJsonLogs } from "./log.js";

const USAGE = usage();

const args = parseArgs(process.argv.slice(2));
setJsonLogs(args.bool("json"));

// A mistyped flag must never be a silent no-op (--staet ≠ crash-safe cursors).
const unknownFlags = args.keys.filter((k) => !KNOWN_FLAGS.has(k));
if (unknownFlags.length > 0) {
  console.error(`unknown flag(s): ${unknownFlags.map((f) => `--${f}`).join(", ")}\n${USAGE}`);
  process.exit(2);
}
const configPath = args.flag("config");

// ── Replay mode: re-deliver a dead-letter file, then exit. Needs delivery
// flags only — no accounts, no watcher — so it runs before that validation.
const replayPath = args.flag("replay");
if (replayPath) {
  try {
    const { replayDeadLetters } = await import("./replay.js");
    const deliveries = deliveriesFor(argsToConfig(args));
    const result = await replayDeadLetters(replayPath, deliveries);
    log(
      "replay",
      { path: replayPath, ...result },
      `replayed ${result.delivered}/${result.total} dead-lettered notification(s)` +
        (result.failed > 0 ? ` — ${result.failed} failed again (kept in a new dead letter)` : ""),
    );
    process.exit(result.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

let config: NotifyConfig;
try {
  config = configPath ? loadConfig(configPath) : argsToConfig(args);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}
// Everything below can throw operator-fixable errors (a corrupt state file,
// an unreachable path) — they deserve one clear line, not a stack trace.
try {
  if (config.accounts.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }

  const condition = conditionFor(config);
  const deliveries = deliveriesFor(config);
  const watcher = accountWatcher({
    accounts: config.accounts,
    network: config.network ?? "mainnet",
    backfill: config.backfill ?? 1,
    ...(config.state ? { statePath: config.state } : {}),
    // Config/flags carry a plain string; the mirror node rejects unknown types
    // at request time, so the cast is safe and stays forward-compatible.
    ...(config.transactionType
      ? { transactionType: config.transactionType as TransactionType }
      : {}),
  });
  const options = {
    watcher,
    deliveries,
    condition,
    pollIntervalMs: pollIntervalMs(config),
    ...(config.deadLetter ? { deadLetterPath: config.deadLetter } : {}),
  };

  log(
    "watching",
    {
      accounts: config.accounts,
      condition: condition.name,
      deliveries: deliveries.map((d) => d.name),
    },
    `watching ${config.accounts.join(", ")}  ·  condition: ${condition.name}  ·  delivery: ${deliveries.map((d) => d.name).join(", ")}`,
  );

  if (args.bool("once")) {
    const n = await pollOnce(options);
    log("poll", { delivered: n }, `\n${n} notification(s) delivered.`);
  } else {
    const controller = new AbortController();
    process.on("SIGINT", () => {
      log("stopping", {}, "\nstopping…");
      controller.abort();
    });
    await watch({ ...options, signal: controller.signal });
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
