# Examples

Build first (`npm run build` — the examples import the package by its real
name, `@hiero-hackers/hiero-notifications`, via Node's self-reference
resolution, so every import line is copy-paste-ready for your own project).
Then run with `node`. Setup and token notes live in the root README.

| File                                             | What it shows                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| [`custom-watch.ts`](custom-watch.ts)             | Writing your own **condition** (NFT moved) and **delivery** (append to a JSONL file)                      |
| [`topic-watcher.ts`](topic-watcher.ts)           | Writing your own **watcher** — live HCS topic messages from mainnet, through the same loop and deliveries |
| [`live-token-watcher.ts`](live-token-watcher.ts) | The built-in **token watcher** live on mainnet — whale-watch deltas                                       |
| [`webhook-receiver.ts`](webhook-receiver.ts)     | The **consumer side**: receive `--webhook` posts, dedupe on `Notification.id`, ack correctly              |
| [`testnet-roundtrip.ts`](testnet-roundtrip.ts)   | The whole loop on **testnet** with real funds — needs `.env` keys and an unpublished sibling (see header) |

`npm run typecheck:examples` keeps these (and the tests) honest — except
testnet-roundtrip, excluded for its unpublished dependency.

**Why no per-channel examples:** built-in channels (console, webhook, Slack,
Discord) are flags — the README covers them. Any channel that is not built in
(email, Telegram, SMS, …) is a custom `Delivery` — the pattern is in
[`custom-watch.ts`](custom-watch.ts), and it is the same ~15 lines whatever
the channel.
