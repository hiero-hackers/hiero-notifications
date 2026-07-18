# hiero-notifications (TypeScript)

[![CI](https://github.com/hiero-hackers/hiero-notifications/actions/workflows/ci.yml/badge.svg)](https://github.com/hiero-hackers/hiero-notifications/actions/workflows/ci.yml)
[![CodeQL](https://github.com/hiero-hackers/hiero-notifications/actions/workflows/codeql.yml/badge.svg)](https://github.com/hiero-hackers/hiero-notifications/actions/workflows/codeql.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/hiero-hackers/hiero-notifications/badge)](https://scorecard.dev/viewer/?uri=github.com/hiero-hackers/hiero-notifications)

Watch Hiero activity and **deliver a notification when something matters** —
to the console, a webhook, Slack, or Discord. Small framework, three moving
parts:

```
Watcher  →  Condition  →  Delivery
(what to    (which ones    (where it
 watch)      matter)        goes)
```

Two **built-in watchers** ship today:

- **account activity** — delivers a provenance-stamped **receipt** (via
  [`@hiero-hackers/hiero-receipts`](https://github.com/hiero-hackers/hiero-receipts)) whenever a
  tracked account transacts.
- **token balances** — a whale watch: notifies with the exact before → after
  delta when a holder of a fungible token gains or loses tokens.

A watcher can carry _any_ payload through the same loop and the same deliveries,
so this is a general notification layer, not an account-only tool — writing your
own is a single file (see below). Prototype.

```
track accounts          →  build receipt      →  match condition  →  deliver
@hiero-enterprise/mirror   hiero-receipts        your predicate      console / webhook
(poll + exchange rate)     (receipt + render)    (over the payload)   / Slack / Discord
```

## Quick start

Dependencies come from the GitHub Packages npm registry
(`@hiero-hackers/hiero-receipts`, `@hiero-hackers/enterprise-mirror` — both
published), which needs a one-time `read:packages` token even for public
packages: `gh auth refresh -s read:packages`, then
`npm config set //npm.pkg.github.com/:_authToken "$(gh auth token)"`. The
scope→registry mapping is already in this repo's `.npmrc`.

```sh
npm install && npm run build

# watch one or more accounts; print a receipt on any balance change:
node dist/cli.js 0.0.1234 0.0.5678

# only when ≥ 100 ℏ comes in, and also POST each receipt to a webhook:
node dist/cli.js 0.0.1234 --min-inflow 100 --webhook https://example.com/hook

# restart-safe: persist cursors, so a restart CATCHES UP on what it missed
# instead of silently re-baselining (at-least-once — never lost, maybe repeated):
node dist/cli.js 0.0.1234 --state .hiero-notify.state.json

# deliveries retry with backoff; whatever STILL fails is appended here as
# JSON lines (channel, error, text) so a dead webhook loses nothing:
node dist/cli.js 0.0.1234 --webhook https://example.com/hook --dead-letter dead.jsonl

# operating it: --json turns the daemon's stderr into parseable JSON lines
# (a "poll" heartbeat with delivered counts, retries, failures) for alerting:
node dist/cli.js 0.0.1234 --json 2>> notify.log

# fixed the webhook? re-deliver everything the dead letter preserved:
node dist/cli.js --replay dead.jsonl --webhook https://fixed.example/hook

# deliver to Slack and/or Discord (incoming webhook URLs — no SDK, no OAuth):
node dist/cli.js 0.0.1234 --slack https://hooks.slack.com/services/…

# watch every transaction type by default — contract calls, topic messages,
# mints all get receipts; restrict with --type when you want only transfers:
node dist/cli.js 0.0.1234 --type CRYPTOTRANSFER

# a one-shot look (poll once and exit):
node dist/cli.js 0.0.1234 --once
```

CLI flags: `--webhook URL` · `--slack URL` · `--discord URL` · `--min-inflow H`
· `--min-outflow H` · `--staking` · `--once` · `--interval SECONDS` ·
`--backfill N` · `--network NAME`.

## Run it as a container (the operator path)

The released image runs the CLI as a non-root daemon, with `/data` for the
state and dead-letter files:

```sh
docker run --rm -v notify-data:/data ghcr.io/hiero-hackers/hiero-notifications:0.1.0 \
  0.0.1234 --state /data/state.json --dead-letter /data/dead.jsonl
```

For a real deployment use [compose.example.yml](compose.example.yml) — config
mounted read-only, state on a named volume, `restart: unless-stopped`.
Building locally needs the registry token as a BuildKit secret (never stored
in a layer): `NPM_TOKEN="$(gh auth token)" docker build --secret id=npm_token,env=NPM_TOKEN -t hiero-notify .`

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
  "triggers": [
    // notify on ANY of these
    { "type": "inflow", "minHbar": 100 },
    { "type": "staking" },
  ],
  "deliveries": {
    "console": true,
    "slack": { "enabled": true, "url": "https://hooks.slack.com/services/…" },
    "discord": { "enabled": false, "url": "https://discord.com/api/webhooks/…" }, // off, URL kept
    "webhook": "https://example.com/hook",
  },
}
```

- **Trigger types:** `any`, `balance-change`, `staking`, `inflow`/`outflow`
  (`{ "type": "inflow", "minHbar": N }`). Listing several means "notify on any."
- **Channels:** a bare URL string, or `{ "url", "enabled" }` so you can flip a
  channel off without losing its URL. `console` defaults on.
- The CLI flags and the config file resolve through the _same_ code, so they
  behave identically. Your real config may hold webhook URLs, so
  `notify.config.json` is gitignored.

## In code

```ts
import {
  watch,
  accountWatcher,
  consoleDelivery,
  webhookDelivery,
  inflowAtLeast,
} from "@hiero-hackers/hiero-notifications";

await watch({
  watcher: accountWatcher({
    accounts: ["0.0.1234"],
    statePath: ".state.json", // restarts catch up instead of re-baselining
  }),
  condition: inflowAtLeast(100), // the "when"
  deliveries: [consoleDelivery, webhookDelivery("https://example.com/hook")],
  deadLetterPath: "dead.jsonl", // failed deliveries kept for --replay
});
// Delivery is at-least-once — dedupe downstream on Notification.id.
```

A **custom** condition and delivery are just objects — see
[`examples/custom-watch.ts`](examples/custom-watch.ts), which composes a
built-in condition with a custom NFT-activity one and adds a delivery that
appends each receipt to a file:

```sh
node examples/custom-watch.ts 0.0.98    # one poll → console + receipts.jsonl
```

## The token watcher (built-in)

```ts
import {
  watch,
  tokenBalanceWatcher,
  tokenDeltaAtLeast,
  consoleDelivery,
} from "@hiero-hackers/hiero-notifications";

await watch({
  watcher: tokenBalanceWatcher({ tokenId: "0.0.456858", minBalance: 100_000 }), // USDC whales
  condition: tokenDeltaAtLeast(1), // any whole-token move of a tracked holder
  deliveries: [consoleDelivery],
});
```

It polls the token's holders, baselines on the first poll, then reports each
holding that changed with the exact `before → after` delta (bigint, in the
token's smallest unit). Pass `minBalance` to track only large holders. Run it
live against mainnet:

```sh
node examples/live-token-watcher.ts 0.0.456858 100000   # USDC holders ≥ 100k
```

## The whole loop, for real, on testnet

[`examples/testnet-roundtrip.ts`](examples/testnet-roundtrip.ts) runs the entire
stack end to end in one terminal — **nothing mocked**. It creates a payment
request, pays it with real testnet HBAR, watches the mirror node for it,
confirms it fulfils the request, and prints the receipt:

```sh
cp .env.example .env          # a free testnet account from portal.hedera.com
npm run example:roundtrip
```

```
── the request ──
  pay      1 ℏ
  to       hedera:testnet:0.0.xxxxx
  memo     INV-1783012345678   ← this is what ties the payment back
── paying ──
  SUCCESS  tx 0.0.xxxxx@1783012345.000000000
── watching 0.0.xxxxx (mirror lags a few seconds) ──
  ┌─ … · account-activity · 0.0.xxxxx
  │ You received 1 ℏ …
  └─
── fulfilment ──
  status    paid
  received  1 ℏ across 1 payment(s)
```

It signs the transfer itself, so it sets the memo — no wallet needed. Set
`DISCORD_WEBHOOK_URL` in `.env` and the receipt goes to a Discord channel too.

> **Why it pays itself.** There's no payment-request URI standard for Hedera, so
> a QR code isn't something a wallet would act on. When the _payer's software_
> builds the transaction, correlation is guaranteed — the open question is only
> whether a human can set a memo by hand in their wallet.

## Watching something else entirely

The loop, conditions, and deliveries are generic over a **payload** — the two
built-ins carry a `Receipt` and a `TokenBalanceChange`, but a watcher can carry
anything. To watch a new kind of activity, write a `Watcher<YourPayload>` that
returns `Notification`s; every delivery you already have works for it unchanged.
[`examples/topic-watcher.ts`](examples/topic-watcher.ts) is a worked template —
a watcher over HCS **topic messages** (payload = a message), delivered through
the same `consoleDelivery`, touching neither the loop nor any delivery:

```sh
node examples/topic-watcher.ts   # offline stub: the ALERT is delivered, the heartbeat filtered
```

## The pieces

- **`Watcher`** — the one thing that touches the network. Built-ins:
  `accountWatcher` (transactions → receipts) and `tokenBalanceWatcher` (holder
  balances → deltas). Each polls `@hiero-enterprise/mirror`, renders its own
  payload, and remembers how far it got (**in memory** — a restart re-baselines
  and does not re-notify history). Injected into the loop, so the loop itself is
  testable with a fake watcher and carries no client dependency.
- **`Condition`** — the notify-me-when predicate over a notification's
  **payload**. Built-ins (over a receipt): `anyBalanceChange`,
  `inflowAtLeast(h)`, `outflowAtLeast(h)`, `stakingReward`; plus the generic
  `anyActivity`, `anyOf(...)`, `allOf(...)`. Write your own by implementing the
  interface.
- **`Delivery`** — where a notification goes. Ships with `consoleDelivery`,
  `webhookDelivery(url)`, `slackDelivery(url)`, and `discordDelivery(url)` —
  all dependency-free (Slack/Discord use _incoming webhooks_: a plain POST, no
  SDK, no OAuth) and payload-agnostic, so they serve every watcher. Email/SMS/etc.
  are just more `Delivery` implementations that bring their own dependency.

## What it reuses vs. owns

- **Reuses** `@hiero-hackers/hiero-receipts` (receipt generation + `toText`/`toHTML`) and
  `@hiero-enterprise/mirror` (fetching + exchange rate).
- **Owns** the I/O `@hiero-hackers/hiero-receipts` refuses: polling, the watch loop, the
  condition, delivery, and any secrets.

## Docs

- [API reference](https://hiero-hackers.github.io/hiero-notifications/) — generated from the TSDoc (`npm run docs`)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the boundary and the watch loop.

## Develop

```sh
npm run typecheck   # tsc --noEmit
npm test            # vitest (loop, conditions, delivery — no network)
npm run lint        # eslint (type-aware) + prettier as errors
npm run build       # → dist/
```

All gates run in CI on every push. See [CONTRIBUTING.md](./CONTRIBUTING.md)
for the ground rules and the DCO sign-off requirement, and
[SECURITY.md](./SECURITY.md) for vulnerability reporting.

## License

Apache-2.0
