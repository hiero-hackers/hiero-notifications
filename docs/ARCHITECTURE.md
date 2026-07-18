# Architecture

`hiero-notifications` is a small framework: **watch Hedera activity → decide
what matters → deliver it.** The built-in watcher sits on top of the
`@hiero-hackers/hiero-receipts` library and owns the I/O that library deliberately refuses:
**fetching, deciding, and delivering.**

## The boundary

```
[ fetch + render ]   →  [ decide ]        →  [ deliver ]
 accountWatcher          Condition            Delivery
 (network + receipt)     (pure predicate)     (I/O + secrets)
  ▲ this app,             ▲ this app            ▲ this app
    library renders
```

The library is a pure `transaction → receipt` function. Everything around it —
the network poll, the "notify me when X" rule, and where the notification goes
— is this app's job.

## Generic over a payload

The core is generic over a **payload** `P`. A `Watcher<P>` yields
`Notification<P>`; a `Condition<P>` is a predicate over that payload; a
`Delivery` reads only the generic notification fields, so it never needs to
know `P`. The account watcher's payload is a `Receipt`, but a watcher can carry
anything — see `examples/topic-watcher.ts`, whose payload is a topic message.
That is what makes this a general _notification_ framework rather than an
account-only tool.

## Dependency injection at the seam

The watch loop (`watcher.ts`) does not import a mirror client. It takes a
`Watcher` — `() => Promise<Notification[]>`, "the notifications new since last
poll." That inversion matters:

- **`pollOnce` / `watch` are pure orchestration** — filter by the `Condition`
  (over the payload), hand each notification to every `Delivery`. Fully testable
  with a fake watcher and fake deliveries; no network, no `@hiero-enterprise/mirror`.
- **Only the watchers touch the network** — `account-watcher.ts` and
  `token-watcher.ts` are where `@hiero-enterprise/mirror` (and, for the account
  watcher, `@hiero-hackers/hiero-receipts`) are imported and where each payload is rendered. The
  ecosystem packages are confined to those files, so the loop, conditions,
  deliveries, and their tests stay free of them.

## Module responsibilities

| Module                | Responsibility                                                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`            | The vocabulary: `Notification<P>` (with `id`, the at-least-once dedupe key), `Condition<P>`, `Delivery`, `Watcher<P>`.                                                                                                                              |
| `watcher.ts`          | The loop: `pollOnce` (filter → deliver, with per-channel retry + backoff and dead-lettering) and `watch`. Payload-agnostic.                                                                                                                         |
| `condition.ts`        | The generic combinators only — `anyActivity`, `anyOf`, `allOf`.                                                                                                                                                                                     |
| `state.ts`            | The persistence that makes restarts catch up instead of silently re-baselining: an atomic JSON file of id → value entries (account cursors, token snapshots). Unreadable state throws — never a silent re-baseline.                                 |
| `log.ts`              | One `log(event, fields, human)`: crafted prose by default, parseable JSON lines under `--json` (including the poll heartbeat).                                                                                                                      |
| `replay.ts`           | `--replay`: re-deliver a dead-letter file verbatim; what fails again is preserved again.                                                                                                                                                            |
| `watchers/account.ts` | Built-in `Watcher` — poll account transactions → receipts, keyset catch-up that defers rather than drops, persisted cursor, injectable `AccountMirror` seam. Owns its receipt conditions. Imports `@hiero-hackers/hiero-receipts`.                  |
| `watchers/token.ts`   | Built-in `Watcher` — poll a token's holder balances, diff snapshots into before → after deltas, persisted baseline, injectable `TokenMirror` seam. Owns `tokenDeltaAtLeast`; pure `diffHolders` is unit-tested.                                     |
| `delivery.ts`         | `consoleDelivery`, `webhookDelivery`, `slackDelivery`, `discordDelivery` — dependency-free, payload-agnostic, markdown-hardened for chat targets.                                                                                                   |
| `config.ts`           | The config model: `NotifyConfig`, `conditionFor` / `deliveriesFor`, `loadConfig`. Unknown keys are errors, never silent no-ops.                                                                                                                     |
| `flags.ts`            | The CLI flag layer: the `FLAG_SPECS` table (single source for the whitelist, `usage()`, and — via tests — the README), `parseArgs`, `argsToConfig`. Changes when the CLI grows ergonomics; `config.ts` changes when the product grows a capability. |
| `cli.ts`              | The `hiero-notify` runner: parse flags or load `--config`, wire it up, watch (or `--once`, or `--replay`). Ships as a container too — see the README's operator section.                                                                            |

Each `watchers/*.ts` module is self-contained — payload type, watcher, and the
conditions over that payload — so adding a data source is one new file there,
touching nothing else. Only these modules import the ecosystem packages.

## Design choices

- **At-least-once, never silent loss.** With `statePath` set, cursors and
  snapshots persist atomically and a restart catches up on what it missed;
  the per-poll catch-up cap defers deep backlogs to the next poll rather than
  dropping them. The failure bias is always duplicate-over-lost — which is
  why every `Notification` carries a stable `id` for consumer dedupe.
- **Baseline on first sight.** On an account's first poll, only the most recent
  `backfill` matches are emitted (default 1) — immediate feedback without a
  flood of history. Subsequent polls emit everything new.
- **Deliveries fail independently, and failure has a floor.** A delivery that
  throws is retried with backoff, then logged and dead-lettered — one broken
  channel must not stop the others or the watch, and `--replay` completes the
  loop once the channel is fixed.
- **Watchers, conditions, and deliveries are pluggable interfaces**, so adding a
  data source, a rule, or a channel is an implementation, not a fork.

## Non-goals

Receipt generation, verification, and rendering — those are `@hiero-hackers/hiero-receipts`.
This app is the caller; it never re-implements what the library already does.
