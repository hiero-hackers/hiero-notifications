/**
 * Replay a dead-letter file — the completion of the at-least-once promise.
 * Each line holds the FULL notification the watcher originally rendered
 * (written by `watcher.ts`'s dead-letter path), so replay re-delivers it
 * verbatim to the channels configured NOW: fix the webhook, then
 * `hiero-notify --replay dead.jsonl --webhook https://fixed.example`.
 *
 * Notifications that fail AGAIN are appended to `<file>.retry.jsonl` in the
 * same replayable shape — a replay never loses what the dead letter
 * preserved. The source file is left untouched; the operator deletes it
 * once satisfied.
 */
import { appendFileSync, readFileSync } from "node:fs";
import type { Delivery, Notification } from "./types.js";
import { log } from "./log.js";

interface DeadLetterLine {
  readonly notification: Notification;
}

export interface ReplayResult {
  readonly total: number;
  readonly delivered: number;
  readonly failed: number;
}

export async function replayDeadLetters(
  path: string,
  deliveries: readonly Delivery[],
): Promise<ReplayResult> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- reading the operator's own --replay path is this feature
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const notifications = lines.map((line, i) => {
    try {
      return (JSON.parse(line) as DeadLetterLine).notification;
    } catch (err) {
      throw new Error(`${path}:${i + 1} is not a valid dead-letter line`, { cause: err });
    }
  });

  let delivered = 0;
  let failed = 0;
  for (const notification of notifications) {
    let lastError: string | undefined;
    for (const channel of deliveries) {
      try {
        await channel.deliver(notification);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        log(
          "replay-delivery-failed",
          { channel: channel.name, id: notification.id, error: lastError },
          `[${channel.name}] replay of ${notification.id} failed: ${lastError}`,
        );
      }
    }
    if (lastError === undefined) {
      delivered += 1;
    } else {
      failed += 1;
      const line = JSON.stringify(
        { failedAt: new Date().toISOString(), channel: "replay", error: lastError, notification },
        // Parsed-from-file notifications already carry string bigints, but a
        // programmatic caller may pass live ones — serialize both safely.
        (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
      );
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the retry file sits beside the operator's own --replay path
      appendFileSync(`${path}.retry.jsonl`, `${line}\n`);
    }
  }
  return { total: notifications.length, delivered, failed };
}
