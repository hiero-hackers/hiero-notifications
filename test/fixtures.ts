import type { Receipt } from "@hiero-hackers/hiero-receipts";
import type { Notification } from "../src/types.js";

/** A minimal valid receipt (100 ℏ inflow), with overrides. */
export function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    account: "0.0.222",
    payer: "0.0.222",
    transactionId: "0.0.111@1.0",
    consensusTimestamp: "1.0",
    txType: "cryptoTransfer",
    status: "success",
    direction: "in",
    movements: [{ asset: "HBAR", amount: 10_000_000_000n, kind: "hbar" }],
    feeTinybar: 0n,
    provenance: { kind: "unverified", source: "mirror" },
    ...overrides,
  };
}

/** A notification carrying a receipt payload, as the account watcher produces. */
export function makeNotification(
  overrides: Partial<Notification<Receipt>> = {},
): Notification<Receipt> {
  const payload = overrides.payload ?? makeReceipt();
  return {
    id: `account-activity:${payload.account}:${payload.transactionId}`,
    source: "account-activity",
    subject: payload.account,
    text: "text",
    html: "<html>",
    at: "2026-01-01T00:00:00Z",
    payload,
    ...overrides,
  };
}
