import { describe, it, expect } from "vitest";
import { anyOf } from "../src/condition.js";
import {
  anyBalanceChange,
  stakingReward,
  inflowAtLeast,
  outflowAtLeast,
} from "../src/watchers/account.js";
import { makeReceipt } from "./fixtures.js";

describe("conditions", () => {
  it("anyBalanceChange matches a movement, skips a no-op", () => {
    expect(anyBalanceChange.matches(makeReceipt())).toBe(true);
    expect(anyBalanceChange.matches(makeReceipt({ movements: [] }))).toBe(false);
  });

  it("inflowAtLeast is inclusive at the threshold", () => {
    expect(inflowAtLeast(100).matches(makeReceipt())).toBe(true); // exactly 100 ℏ
    expect(inflowAtLeast(101).matches(makeReceipt())).toBe(false);
  });

  it("outflowAtLeast reads a negative HBAR movement", () => {
    const out = makeReceipt({
      movements: [{ asset: "HBAR", amount: -20_000_000_000n, kind: "hbar" }],
    });
    expect(outflowAtLeast(200).matches(out)).toBe(true);
    expect(outflowAtLeast(201).matches(out)).toBe(false);
  });

  it("stakingReward matches only when a reward was paid", () => {
    expect(stakingReward.matches(makeReceipt({ stakingRewardTinybar: 500_000_000n }))).toBe(true);
    expect(stakingReward.matches(makeReceipt())).toBe(false);
  });

  it("anyOf matches if either side does", () => {
    const c = anyOf(stakingReward, inflowAtLeast(100));
    expect(c.matches(makeReceipt())).toBe(true); // inflow qualifies even without a reward
  });
});

describe("anyOf / allOf composition (audit #5)", () => {
  const yes = { name: "yes", matches: () => true };
  const no = { name: "no", matches: () => false };

  it("anyOf matches when at least one branch does, and names itself", async () => {
    const { anyOf } = await import("../src/condition.js");
    expect(anyOf(no, yes).matches(makeReceipt({}))).toBe(true);
    expect(anyOf(no, no).matches(makeReceipt({}))).toBe(false);
    expect(anyOf(no, yes).name).toBe("no|yes");
  });

  it("allOf requires every branch", async () => {
    const { allOf } = await import("../src/condition.js");
    expect(allOf(yes, yes).matches(makeReceipt({}))).toBe(true);
    expect(allOf(yes, no).matches(makeReceipt({}))).toBe(false);
  });
});
