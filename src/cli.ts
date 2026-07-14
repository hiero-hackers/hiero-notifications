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
 */
import { pollOnce, watchAccounts } from "./watcher.js";
import { mirrorSource } from "./mirror-source.js";
import { parseArgs, argsToConfig, loadConfig, conditionFor, deliveriesFor, pollIntervalMs } from "./config.js";
import type { NotifyConfig } from "./config.js";

const USAGE =
  "usage: hiero-notify --config FILE  |  hiero-notify <account...> [--webhook URL] [--slack URL] [--discord URL] [--min-inflow H] [--min-outflow H] [--staking] [--once] [--interval S] [--backfill N] [--network NAME]";

const args = parseArgs(process.argv.slice(2));
const configPath = args.flag("config");

let config: NotifyConfig;
try {
  config = configPath ? loadConfig(configPath) : argsToConfig(args);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}
if (config.accounts.length === 0) {
  console.error(USAGE);
  process.exit(2);
}

const condition = conditionFor(config);
const deliveries = deliveriesFor(config);
const source = mirrorSource({
  accounts: config.accounts,
  network: config.network ?? "mainnet",
  backfill: config.backfill ?? 1,
});
const options = { source, deliveries, condition, pollIntervalMs: pollIntervalMs(config) };

console.error(`watching ${config.accounts.join(", ")}  ·  condition: ${condition.name}  ·  delivery: ${deliveries.map((d) => d.name).join(", ")}`);

if (args.bool("once")) {
  const n = await pollOnce(options);
  console.error(`\n${n} notification(s) delivered.`);
} else {
  const controller = new AbortController();
  process.on("SIGINT", () => {
    console.error("\nstopping…");
    controller.abort();
  });
  await watchAccounts({ ...options, signal: controller.signal });
}
