/**
 * The shared vocabulary. This app is the *caller* that owns the I/O
 * `hiero-receipts` deliberately refuses: it fetches transactions, decides
 * which ones matter (`Condition`), and delivers them (`Delivery`). The
 * receipt itself comes from `hiero-receipts`.
 */
import type { Receipt } from "hiero-receipts";

/** A receipt produced for one account by a poll. */
export interface AccountReceipt {
  readonly account: string;
  readonly receipt: Receipt;
}

/** What a delivery channel receives when a watched account transacts. */
export interface NotificationEvent {
  readonly account: string;
  readonly receipt: Receipt;
  /** The receipt as plain text (email/SMS/console). */
  readonly text: string;
  /** The receipt as self-contained HTML (email body / webhook payload). */
  readonly html: string;
  /** ISO timestamp the notification fired. */
  readonly at: string;
}

/** Decides whether a receipt is worth notifying about (the "XYZ"). Pure. */
export interface Condition {
  readonly name: string;
  matches(receipt: Receipt): boolean;
}

/** Sends a notification somewhere. Where the I/O and secrets live. */
export interface Delivery {
  readonly name: string;
  deliver(event: NotificationEvent): Promise<void>;
}

/**
 * Yields the receipts that are *new since the last call*, for the tracked
 * accounts. Injected into the watcher so the loop is testable with a fake
 * source and carries no dependency on any particular data client.
 */
export type Source = () => Promise<AccountReceipt[]>;
