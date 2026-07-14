/**
 * The watch loop — pure orchestration: pull the receipts new since last poll
 * from a `Source`, keep the ones a `Condition` accepts, and hand each to every
 * `Delivery`. The `Source` is injected, so this core has no dependency on any
 * data client and is fully testable with fakes.
 */
import { toHTML, toText } from "hiero-receipts";
import type { Condition, Delivery, NotificationEvent, Source } from "./types.js";
import { anyTransaction } from "./condition.js";

export interface WatchOptions {
  readonly source: Source;
  readonly deliveries: readonly Delivery[];
  /** Which transactions to notify about (default: all). */
  readonly condition?: Condition;
  /** Milliseconds between polls (default 15000). */
  readonly pollIntervalMs?: number;
  /** Stop the loop. */
  readonly signal?: AbortSignal;
  /** Injectable clock, for tests. */
  readonly now?: () => Date;
}

/**
 * Run one poll: fetch new receipts, filter, deliver. Returns how many
 * notifications were delivered. A delivery that throws is logged, not fatal —
 * one broken channel must not stop the others or the watch.
 */
export async function pollOnce(opts: WatchOptions): Promise<number> {
  const condition = opts.condition ?? anyTransaction;
  const now = opts.now ?? (() => new Date());
  let delivered = 0;

  for (const { account, receipt } of await opts.source()) {
    if (!condition.matches(receipt)) continue;
    const event: NotificationEvent = {
      account,
      receipt,
      text: toText(receipt),
      html: toHTML(receipt),
      at: now().toISOString(),
    };
    for (const channel of opts.deliveries) {
      try {
        await channel.deliver(event);
      } catch (err) {
        console.error(`[${channel.name}] delivery failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    delivered += 1;
  }
  return delivered;
}

/** Poll forever (until `signal` aborts), `pollIntervalMs` apart. */
export async function watchAccounts(opts: WatchOptions): Promise<void> {
  const interval = opts.pollIntervalMs ?? 15_000;
  while (!opts.signal?.aborted) {
    try {
      await pollOnce(opts);
    } catch (err) {
      console.error(`poll failed: ${err instanceof Error ? err.message : err}`);
    }
    if (opts.signal?.aborted) break;
    await sleep(interval, opts.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
