/**
 * LIVE, read-only checks against the real mainnet mirror node — the shape
 * drift the fakes cannot see. Not part of `npm test` (see test/README.md);
 * run with `npm run test:live` before a release.
 *
 * Asserts SHAPES, not values. The default subjects are busy today
 * (mirror-monitor infrastructure); if one goes quiet, the failure message
 * says to update it — that is drift worth hearing about too.
 */
import { describe, expect, it } from "vitest";
import { createMirrorNodeClient } from "@hiero-hackers/enterprise-mirror";
import { accountWatcher } from "../../src/watchers/account.js";

const mirror = createMirrorNodeClient({ network: "mainnet" });
const BUSY_ACCOUNT = "0.0.3229"; // mirror-monitor: transacts around the clock
const BUSY_TOPIC = "0.0.10650556"; // its heartbeat topic

describe("mainnet mirror, read-only", () => {
  it("exchange rates come back as the numbers the fiat pipeline needs", async () => {
    const { currentRate } = await mirror.queryExchangeRates();
    expect(typeof currentRate.hbarEquivalent).toBe("number");
    expect(typeof currentRate.centEquivalent).toBe("number");
    expect(currentRate.hbarEquivalent).toBeGreaterThan(0);
  });

  it("transactions-by-account has the shape the watcher pages over", async () => {
    const page = await mirror.queryTransactionsByAccount(BUSY_ACCOUNT, {
      limit: 3,
      order: "desc",
    });
    expect(
      page.data.length,
      `${BUSY_ACCOUNT} returned nothing — busy default gone quiet?`,
    ).toBeGreaterThan(0);
    for (const tx of page.data) {
      expect(tx.consensusTimestamp).toMatch(/^\d+\.\d+$/);
      expect(tx.transactionId).toMatch(/^\d+\.\d+\.\d+/);
      expect(Array.isArray(tx.transfers)).toBe(true);
    }
  });

  it("topic messages decode from base64 with numeric-string sequences", async () => {
    const page = await mirror.queryTopicMessages(BUSY_TOPIC, { limit: 2, order: "desc" });
    expect(
      page.data.length,
      `${BUSY_TOPIC} returned nothing — busy default gone quiet?`,
    ).toBeGreaterThan(0);
    for (const m of page.data) {
      expect(m.sequenceNumber).toMatch(/^\d+$/);
      expect(() => Buffer.from(m.message, "base64").toString("utf8")).not.toThrow();
    }
  });

  it("the whole account watcher produces a rendered receipt from live data", async () => {
    const notifications = await accountWatcher({
      accounts: [BUSY_ACCOUNT],
      backfill: 1,
    })();
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0]!.text).toContain("Receipt for account");
    expect(notifications[0]!.id).toMatch(/^account-activity:/);
  });
});
