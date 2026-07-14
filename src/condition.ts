/**
 * Conditions — the "notify me when XYZ" predicates, expressed over a receipt's
 * fields. Pure and composable; add your own by implementing `Condition`.
 */
import type { Receipt } from "hiero-receipts";
import type { Condition } from "./types.js";

/** Every transaction. */
export const anyTransaction: Condition = { name: "any", matches: () => true };

/** Any actual balance change (HBAR, token, or NFT) — skips no-op transactions. */
export const anyBalanceChange: Condition = {
  name: "balance-change",
  matches: (r) => r.movements.length > 0 || (r.nft?.length ?? 0) > 0,
};

/** A staking reward was paid to the account. */
export const stakingReward: Condition = {
  name: "staking-reward",
  matches: (r) => (r.stakingRewardTinybar ?? 0n) > 0n,
};

/** Net HBAR received is at least `hbar`. */
export function inflowAtLeast(hbar: number): Condition {
  const min = toTinybar(hbar);
  return { name: `inflow>=${hbar}h`, matches: (r) => hbarNet(r) >= min };
}

/** Net HBAR sent is at least `hbar`. */
export function outflowAtLeast(hbar: number): Condition {
  const min = toTinybar(hbar);
  return { name: `outflow>=${hbar}h`, matches: (r) => -hbarNet(r) >= min };
}

/** Matches when any of the given conditions matches. */
export function anyOf(...conditions: Condition[]): Condition {
  return { name: conditions.map((c) => c.name).join("|"), matches: (r) => conditions.some((c) => c.matches(r)) };
}

/** Matches when every given condition matches. */
export function allOf(...conditions: Condition[]): Condition {
  return { name: conditions.map((c) => c.name).join("&"), matches: (r) => conditions.every((c) => c.matches(r)) };
}

const hbarNet = (r: Receipt): bigint => r.movements.find((m) => m.kind === "hbar")?.amount ?? 0n;
const toTinybar = (hbar: number): bigint => BigInt(Math.round(hbar * 100_000_000));
