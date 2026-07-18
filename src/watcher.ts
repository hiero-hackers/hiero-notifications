/**
 * The watch loop — pure orchestration: pull the notifications new since the
 * last poll from a `Watcher`, keep the ones a `Condition` accepts (matched on
 * the payload), and hand each to every `Delivery`. The `Watcher` is injected,
 * so this core has no dependency on any data client and no knowledge of what
 * is being watched — it is fully testable with a fake watcher.
 */
import { appendFileSync } from "node:fs";
import type { Condition, Delivery, Notification, Watcher } from "./types.js";
import { anyActivity } from "./condition.js";
import { log, logJson } from "./log.js";

export interface WatchOptions {
  readonly watcher: Watcher;
  readonly deliveries: readonly Delivery[];
  /** Which payloads to notify about (default: all). */
  readonly condition?: Condition;
  /** Milliseconds between polls (default 15000). */
  readonly pollIntervalMs?: number;
  /** Stop the loop. */
  readonly signal?: AbortSignal;
  /** Retries per failing delivery after the first attempt (default 2). */
  readonly deliveryRetries?: number;
  /** Backoff before the first retry, doubling each attempt (default 500ms). */
  readonly retryBackoffMs?: number;
  /**
   * Append notifications that STILL failed after every retry to this file
   * (one JSON line each: when, channel, error, and the notification's text)
   * — so a dead webhook loses nothing an operator can't replay. Without it,
   * a final failure is only logged.
   */
  readonly deadLetterPath?: string;
}

/**
 * Run one poll: fetch new notifications, filter, deliver. Returns how many
 * were delivered. A delivery that throws is retried with backoff; a channel
 * that still fails is logged (and dead-lettered when configured), never
 * fatal — one broken channel must not stop the others or the watch.
 */
export async function pollOnce(opts: WatchOptions): Promise<number> {
  const condition = opts.condition ?? anyActivity;
  const retries = opts.deliveryRetries ?? 2;
  const backoffMs = opts.retryBackoffMs ?? 500;
  let delivered = 0;

  for (const notification of await opts.watcher()) {
    if (!condition.matches(notification.payload)) continue;
    for (const channel of opts.deliveries) {
      await deliverWithRetry(channel, notification, retries, backoffMs, opts);
    }
    delivered += 1;
  }
  return delivered;
}

async function deliverWithRetry(
  channel: Delivery,
  notification: Notification,
  retries: number,
  backoffMs: number,
  opts: WatchOptions,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await channel.deliver(notification);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < retries && !opts.signal?.aborted) {
        const wait = backoffMs * 2 ** attempt;
        log(
          "delivery-retry",
          { channel: channel.name, error: message, waitMs: wait },
          `[${channel.name}] delivery failed (${message}) — retrying in ${wait}ms`,
        );
        await sleep(wait, opts.signal);
        continue;
      }
      log(
        "delivery-failed",
        { channel: channel.name, error: message, attempts: attempt + 1 },
        `[${channel.name}] delivery failed after ${attempt + 1} attempt(s): ${message}`,
      );
      if (opts.deadLetterPath) deadLetter(opts.deadLetterPath, channel.name, message, notification);
      return;
    }
  }
}

/**
 * One JSON line per lost notification — the FULL notification (bigints as
 * strings), so `hiero-notify --replay FILE` can re-deliver it verbatim.
 */
function deadLetter(
  path: string,
  channel: string,
  error: string,
  notification: Notification,
): void {
  const line = JSON.stringify(
    {
      failedAt: new Date().toISOString(),
      channel,
      error,
      notification,
    },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- appending to the operator's own --dead-letter path is this feature
    appendFileSync(path, `${line}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(
      "dead-letter-failed",
      { path, error: message },
      `dead-letter write to ${path} failed: ${message}`,
    );
  }
}

/** Poll forever (until `signal` aborts), `pollIntervalMs` apart. */
export async function watch(opts: WatchOptions): Promise<void> {
  const interval = opts.pollIntervalMs ?? 15_000;
  while (!opts.signal?.aborted) {
    try {
      const delivered = await pollOnce(opts);
      logJson("poll", { delivered }); // the parseable heartbeat
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("poll-failed", { error: message }, `poll failed: ${message}`);
    }
    if (opts.signal?.aborted) break;
    await sleep(interval, opts.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
