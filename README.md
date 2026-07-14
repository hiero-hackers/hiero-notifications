# hiero-account-notifications (TypeScript)

Watch Hedera accounts and deliver a **provenance-stamped receipt** whenever
they transact. This is the *app tier* over
[`hiero-receipts`](https://github.com/hiero-hackers/hiero-receipts): it owns
the I/O that library deliberately refuses — fetching, condition logic, and
delivery. Prototype.

```
track accounts          →  build receipt      →  match condition  →  deliver
@hiero-enterprise/mirror   hiero-receipts        your predicate      console / webhook
(poll + exchange rate)     (receipt + render)    (over receipt        (email/Slack = more
                                                  fields)              deliveries)
```

## Quick start

> **Workspace note.** This app depends on `hiero-receipts` and
> `@hiero-enterprise/mirror`, which aren't on npm yet, so it currently runs
> from the workspace (the `file:` deps in `package.json`). Once those publish,
> it's a normal `npm install`.

```sh
npm install && npm run build

# watch one or more accounts; print a receipt on any balance change:
node dist/cli.js 0.0.1234 0.0.5678

# only when ≥ 100 ℏ comes in, and also POST each receipt to a webhook:
node dist/cli.js 0.0.1234 --min-inflow 100 --webhook https://example.com/hook

# deliver to Slack and/or Discord (incoming webhook URLs — no SDK, no OAuth):
node dist/cli.js 0.0.1234 --slack https://hooks.slack.com/services/…

# a one-shot look (poll once and exit):
node dist/cli.js 0.0.1234 --once
```

CLI flags: `--webhook URL` · `--slack URL` · `--discord URL` · `--min-inflow H`
· `--min-outflow H` · `--staking` · `--once` · `--interval SECONDS` ·
`--backfill N` · `--network NAME`.

## Config file (recommended for a real setup)

For anything beyond a quick one-off, a JSON config is easier to manage — turn a
channel on/off, keep its URL, and set the trigger, all in one place. Copy
[`notify.config.example.json`](notify.config.example.json), edit it, and run:

```sh
node dist/cli.js --config notify.config.json
```

```jsonc
{
  "network": "mainnet",
  "pollIntervalSeconds": 15,
  "accounts": ["0.0.1234", "0.0.5678"],
  "triggers": [                         // notify on ANY of these
    { "type": "inflow", "minHbar": 100 },
    { "type": "staking" }
  ],
  "deliveries": {
    "console": true,
    "slack":   { "enabled": true,  "url": "https://hooks.slack.com/services/…" },
    "discord": { "enabled": false, "url": "https://discord.com/api/webhooks/…" },  // off, URL kept
    "webhook": "https://example.com/hook"
  }
}
```

- **Trigger types:** `any`, `balance-change`, `staking`, `inflow`/`outflow`
  (`{ "type": "inflow", "minHbar": N }`). Listing several means "notify on any."
- **Channels:** a bare URL string, or `{ "url", "enabled" }` so you can flip a
  channel off without losing its URL. `console` defaults on.
- The CLI flags and the config file resolve through the *same* code, so they
  behave identically. Your real config may hold webhook URLs, so
  `notify.config.json` is gitignored.

## In code

```ts
import { watchAccounts, mirrorSource, consoleDelivery, webhookDelivery, inflowAtLeast } from "hiero-account-notifications";

await watchAccounts({
  source: mirrorSource({ accounts: ["0.0.1234"] }),
  condition: inflowAtLeast(100),                    // the "XYZ"
  deliveries: [consoleDelivery, webhookDelivery("https://example.com/hook")],
});
```

A **custom** condition and delivery are just objects — see
[`examples/custom-watch.ts`](examples/custom-watch.ts), which composes a
built-in condition with a custom NFT-activity one and adds a delivery that
appends each receipt to a file:

```sh
node examples/custom-watch.ts 0.0.98    # one poll → console + receipts.jsonl
```

## The pieces

- **`Source`** (`mirrorSource`) — the one thing that touches the network. It
  polls `@hiero-enterprise/mirror`, turns new transactions into receipts, and
  remembers how far it got (**in memory** — a restart re-baselines and does not
  re-notify history). Injected into the watcher, so the loop itself is testable
  with a fake source and carries no client dependency.
- **`Condition`** — the notify-me-when predicate over a receipt's fields.
  Built-ins: `anyBalanceChange`, `inflowAtLeast(h)`, `outflowAtLeast(h)`,
  `stakingReward`, `anyOf(...)`, `allOf(...)`. Write your own by implementing
  the interface.
- **`Delivery`** — where a notification goes. Ships with `consoleDelivery`,
  `webhookDelivery(url)`, `slackDelivery(url)`, and `discordDelivery(url)` —
  all dependency-free (Slack/Discord use *incoming webhooks*: a plain POST, no
  SDK, no OAuth). Email/SMS/etc. are just more `Delivery` implementations that
  bring their own dependency + secrets, which is why they'd live in the app.

## What it reuses vs. owns

- **Reuses** `hiero-receipts` (receipt generation + `toText`/`toHTML`) and
  `@hiero-enterprise/mirror` (fetching + exchange rate).
- **Owns** the I/O `hiero-receipts` refuses: polling, the watch loop, the
  condition, delivery, and any secrets.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the boundary and the watch loop.

## Develop

```sh
npm run typecheck   # tsc --noEmit
npm test            # vitest (watcher, conditions, delivery — no network)
npm run build       # → dist/
```

## License

Apache-2.0
