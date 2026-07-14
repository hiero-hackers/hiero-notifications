# Architecture

`hiero-account-notifications` is the **application** that sits on top of the
`hiero-receipts` library. Its whole reason to exist is to own the I/O the
library deliberately refuses: **fetching, deciding, and delivering.**

## The boundary

```
[ fetch ]        →  [ build receipt ]  →  [ decide ]      →  [ deliver ]
 mirrorSource        hiero-receipts        Condition          Delivery
 (network)           (pure)                (pure predicate)   (I/O + secrets)
  ▲ this app          ▲ the library         ▲ this app          ▲ this app
```

The library is a pure `transaction → receipt` function. Everything around it —
the network poll, the "notify me when X" rule, and where the notification goes
— is this app's job.

## Dependency injection at the seam

The watch loop (`watcher.ts`) does not import a mirror client. It takes a
`Source` — `() => Promise<AccountReceipt[]>`, "the receipts new since last
poll." That inversion matters:

- **`pollOnce` / `watchAccounts` are pure orchestration** — filter by the
  `Condition`, render, hand to each `Delivery`. Fully testable with a fake
  source and fake deliveries; no network, no `@hiero-enterprise/mirror`.
- **Only `mirrorSource` touches the network** — it's where
  `@hiero-enterprise/mirror` and `hiero-receipts` are imported. So the two
  ecosystem packages are confined to one file, and the rest of the app (and its
  tests) stays free of them.

## Module responsibilities

| Module | Responsibility |
|---|---|
| `types.ts` | `Condition`, `Delivery`, `Source`, `NotificationEvent`, `AccountReceipt`. |
| `watcher.ts` | The loop: `pollOnce` (filter → render → deliver) and `watchAccounts`. Pure. |
| `mirror-source.ts` | The network `Source` — poll, receipt, in-memory cursor. The only file importing the ecosystem packages. |
| `condition.ts` | Built-in predicates over a receipt (`inflowAtLeast`, `stakingReward`, …). |
| `delivery.ts` | `consoleDelivery` + `webhookDelivery` (dependency-free). |
| `cli.ts` | The `hiero-notify` runner: parse flags, wire it up, watch. |

## Design choices

- **In-memory state.** The cursor (newest transaction seen per account) lives in
  a `Map`. A restart re-baselines — it will not re-notify history, but it also
  won't recover events missed while down. Persistence (a file or DB) would be a
  new `Source` wrapper, not a change to the loop.
- **Baseline on first sight.** On an account's first poll, only the most recent
  `backfill` matches are emitted (default 1) — immediate feedback without a
  flood of history. Subsequent polls emit everything new.
- **Deliveries fail independently.** A delivery that throws is logged, never
  fatal — one broken channel must not stop the others or the watch.
- **Conditions and deliveries are pluggable interfaces**, so adding a rule or a
  channel is an implementation, not a fork.

## Non-goals

Receipt generation, verification, and rendering — those are `hiero-receipts`.
This app is the caller; it never re-implements what the library already does.
