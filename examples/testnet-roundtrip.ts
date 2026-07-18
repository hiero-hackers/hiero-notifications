/**
 * The whole loop, for real, on testnet — in one terminal.
 *
 *   1. create a payment request        hiero-payment-requests
 *   2. pay it (we sign it ourselves)   @hiero-hackers/enterprise-core   ← the write side
 *   3. watch the payee's account       hiero-notifications              ← via enterprise-mirror
 *   4. confirm it fulfils the request  hiero-payment-requests
 *   5. print the receipt               hiero-receipts
 *
 * Not a simulation: this moves real testnet HBAR and reads it back from the
 * real mirror node. Nothing here is mocked.
 *
 *   cp .env.example .env     # then fill in your testnet operator
 *   npm run example:roundtrip
 *
 * (which is `node --env-file-if-exists=.env …` — Node reads the .env itself,
 * so there's no dotenv dependency.)
 *
 * **TESTNET ONLY.** The example refuses to run against any other network — see
 * the guard below. Testnet HBAR is free from the faucet and worth nothing.
 *
 * **Why we send the payment ourselves.** There is no payment-request URI
 * standard for Hedera, so a QR code isn't something any wallet would act on. By
 * building the transfer here we set the memo ourselves — which is exactly the
 * point: when the *payer's software* builds the transaction, correlation is
 * guaranteed. Whether a human with a wallet can set a memo by hand is the open
 * question, and a different experiment.
 *
 * Needs the workspace built: `npm install && npm run build`.
 */
import { AccountService, Hbar, HieroContext, PrivateKey } from "@hiero-hackers/enterprise-core";
import {
  accountWatcher,
  consoleDelivery,
  discordDelivery,
  pollOnce,
} from "@hiero-hackers/hiero-notifications";
import type { Delivery, Notification, Watcher } from "@hiero-hackers/hiero-notifications";
import type { Receipt } from "@hiero-hackers/hiero-receipts";
// hiero-payment-requests is UNPUBLISHED — it resolves from a built sibling
// checkout at runtime (type imports are erased, so only this dynamic import
// touches the disk). The example is excluded from `typecheck:examples` for
// the same reason.
import type { Payment, PaymentRequest } from "hiero-payment-requests";

const paymentRequests = await import("../../hiero-payment-requests/dist/index.js").catch(() => {
  console.error(`this example needs a built sibling checkout of hiero-payment-requests:
  git clone https://github.com/hiero-hackers/hiero-payment-requests ../hiero-payment-requests
  cd ../hiero-payment-requests && npm install && npm run build`);
  process.exit(1);
});
const { createRequest, fromReceipt, fulfils, match } = paymentRequests;

const AMOUNT_TINYBAR = 100_000_000n; // 1 ℏ
const POLL_MS = 3_000;
const ATTEMPTS = 20;

// ── Setup ────────────────────────────────────────────────────────────────

// `new HieroContext()` with no argument reads HIERO_* from the environment and
// validates them — so there's no hand-rolled env plumbing in this example.
const context = mustBuildContext();
const network = context.config.network;

// Refuse to touch anything but testnet. This example spends real money on any
// other network, and nothing about it needs to.
if (network !== "testnet") {
  console.error(`\n  This example is testnet-only, but HIERO_NETWORK is "${network}".`);
  console.error("  Refusing to run. Set HIERO_NETWORK=testnet in .env.\n");
  process.exit(2);
}

const accounts = new AccountService(context);
const operatorId = context.operatorAccountId.toString();
const discordUrl = process.env["DISCORD_WEBHOOK_URL"];

// A payee to be paid. Bring your own, or we make a throwaway — the payer and
// the payee must differ, since paying yourself nets to zero and credits nobody.
const payeeId = process.env["PAYEE_ID"] || (await createThrowawayPayee());
console.log(
  `\npayer  ${operatorId}\npayee  ${payeeId}  ${process.env["PAYEE_ID"] ? "" : "(throwaway, created just now)"}\n`,
);

// ── 1. The request ───────────────────────────────────────────────────────

const request: PaymentRequest = {
  recipient: `hedera:${network}:${payeeId}`,
  // PROVISIONAL: HIP-30 defines no identifier for native HBAR, so this form is
  // ours. The most common request there is cannot name its asset in the
  // standard — which is the gap worth raising upstream.
  asset: `hedera:${network}/slip44:3030`,
  amount: AMOUNT_TINYBAR,
  reference: `INV-${Date.now()}`,
  label: "1 ℏ — roundtrip demo",
};
createRequest(request); // validate now, not after the money moves

console.log("── the request ──");
console.log(`  ${request.label}`);
console.log(`  pay      ${fmt(request.amount)} ℏ`);
console.log(`  to       ${request.recipient}`);
console.log(`  memo     ${request.reference}   ← this is what ties the payment back`);

// ── 2. Pay it ────────────────────────────────────────────────────────────

console.log("\n── paying ──");
await accounts.transferHbar(
  payeeId,
  // `Hbar.fromTinybars(string)`, not a plain number: `transferHbar` accepts
  // `number | Hbar`, and the number path is whole HBAR via a float. Money never
  // goes through a float here — the request's amount is already exact tinybar.
  Hbar.fromTinybars(AMOUNT_TINYBAR.toString()),
  operatorId,
  { transactionMemo: request.reference }, // we set it — no wallet, no bet
);
// NOTE: `transferHbar` returns void, so there is no transaction id to print
// here. For a payment flow you generally want one. Raised upstream.
console.log(`  sent ${fmt(AMOUNT_TINYBAR)} ℏ with memo ${request.reference}`);

// ── 3. Watch for it ──────────────────────────────────────────────────────

// Wrap the watcher so we keep every receipt it emits — `pollOnce` only forwards
// the ones the condition accepts, but `match` wants the whole picture.
const seen: Notification<Receipt>[] = [];
const base = accountWatcher({ accounts: [payeeId], network, backfill: 10 });
const watcher: Watcher<Receipt> = async () => {
  const batch = await base();
  seen.push(...batch);
  return batch;
};

const toPayment = (r: Receipt): Payment => fromReceipt(r, network);
const deliveries: Delivery[] = [consoleDelivery];
if (discordUrl) deliveries.push(discordDelivery(discordUrl));

console.log(`\n── watching ${payeeId} (mirror lags a few seconds) ──`);
let delivered = 0;
for (let attempt = 1; attempt <= ATTEMPTS && delivered === 0; attempt++) {
  delivered = await pollOnce({ watcher, condition: fulfils(request, toPayment), deliveries });
  if (delivered === 0) {
    process.stderr.write(`  poll ${attempt}/${ATTEMPTS}…\r`);
    await sleep(POLL_MS);
  }
}

// ── 4. What does the chain say about the request? ────────────────────────

const result = match(
  request,
  seen.map((n) => toPayment(n.payload)),
);

console.log("\n── fulfilment ──");
console.log(`  status    ${result.status}`);
if ("received" in result)
  console.log(`  received  ${fmt(result.received)} ℏ across ${result.payments.length} payment(s)`);
if ("shortfall" in result) console.log(`  shortfall ${fmt(result.shortfall)} ℏ`);
if ("excess" in result) console.log(`  excess    ${fmt(result.excess)} ℏ`);
if ("late" in result && result.late) console.log(`  late      yes`);

console.log(
  delivered > 0
    ? `\n✓ paid, matched, and the receipt was delivered to ${deliveries.map((d) => d.name).join(" + ")}.`
    : `\n✗ no fulfilment seen in ${(ATTEMPTS * POLL_MS) / 1000}s — mirror may still be indexing; run again.`,
);
context.close();
process.exit(delivered > 0 ? 0 : 1);

// ── helpers ──────────────────────────────────────────────────────────────

/** Missing credentials is the first thing every reader will hit. Say what to do
 *  about it, rather than throwing a stack trace at them. */
function mustBuildContext(): HieroContext {
  try {
    return new HieroContext();
  } catch (err) {
    console.error(`\n  ${err instanceof Error ? err.message : err}\n`);
    console.error("  cp .env.example .env       # then add a funded testnet operator");
    console.error("  npm run example:roundtrip  # loads .env via node --env-file");
    console.error("  Free testnet account + faucet: https://portal.hedera.com\n");
    process.exit(2);
  }
}

async function createThrowawayPayee(): Promise<string> {
  const key = PrivateKey.generateED25519();
  const account = await accounts.createAccount({
    publicKey: key.publicKey.toStringDer(),
    initialBalance: 0,
  });
  return account.accountId;
}

/** Tinybar → ℏ, exactly. Integer split, never a float. */
function fmt(tinybar: bigint): string {
  const sign = tinybar < 0n ? "-" : "";
  const abs = tinybar < 0n ? -tinybar : tinybar;
  const frac = (abs % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${sign}${abs / 100_000_000n}.${frac}` : `${sign}${abs / 100_000_000n}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
