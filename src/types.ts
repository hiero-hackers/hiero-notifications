/**
 * The shared vocabulary of the framework. Everything is generic over a
 * **payload** `P` — the typed detail of what happened. The built-in account
 * watcher's payload is a `Receipt` from `@hiero-hackers/hiero-receipts`, but a watcher can
 * carry any payload (a topic message, a token event, …), which is what keeps
 * this a general *notification* framework rather than an account-only tool.
 *
 * A `Watcher` produces `Notification`s → a `Condition` decides which matter →
 * a `Delivery` sends them. Deliveries only touch the generic fields, so they
 * work unchanged for every watcher.
 */

/**
 * One thing worth notifying about, from any watcher. The `payload` is the
 * typed detail; `text`/`html`/`subject`/`source` are the presentation the
 * watcher already rendered, so a `Delivery` never needs to know what `P` is.
 */
export interface Notification<P = unknown> {
  /**
   * Stable, unique id for THIS notification — the dedupe key. Delivery is
   * at-least-once (a crash between deliver and cursor-save re-delivers), so
   * consumers deduplicate on `id`; it also travels in webhook payloads and
   * dead-letter lines. Convention: `source:subject:event-identity`, e.g.
   * `account-activity:0.0.1234:0.0.99-1721300000-000000001`.
   */
  readonly id: string;
  /** Which watcher produced it, e.g. `"account-activity"`, `"topic-messages"`. */
  readonly source: string;
  /** What is being watched, e.g. an account id `"0.0.1234"` or a topic id. */
  readonly subject: string;
  /** Human-readable body (console / chat / SMS). */
  readonly text: string;
  /** Optional rich body (email / an HTML webhook). */
  readonly html?: string;
  /** ISO timestamp the notification fired. */
  readonly at: string;
  /** The typed detail. For the account watcher this is a `Receipt`. */
  readonly payload: P;
}

/**
 * Decides whether a payload is worth notifying about (the "notify me when
 * XYZ"). A predicate over the payload — pure and composable.
 */
export interface Condition<P = unknown> {
  readonly name: string;
  matches(payload: P): boolean;
}

/**
 * Sends a notification somewhere. Payload-agnostic on purpose: it reads only
 * the generic `Notification` fields, so one delivery serves every watcher.
 * Where the I/O and secrets live.
 */
export interface Delivery {
  readonly name: string;
  deliver(notification: Notification): Promise<void>;
}

/**
 * Yields the notifications that are *new since the last call*. Injected into
 * the watch loop, so the loop has no dependency on any data client and is
 * fully testable with a fake watcher. The account watcher is the built-in;
 * write your own by returning `Notification<YourPayload>[]`.
 */
export type Watcher<P = unknown> = () => Promise<Notification<P>[]>;
