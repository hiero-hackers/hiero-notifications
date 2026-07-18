/**
 * The generic condition combinators — payload-agnostic, so they compose any
 * watcher's conditions. The payload-specific predicates live with their watcher
 * (receipt conditions in `watchers/account.ts`, token conditions in
 * `watchers/token.ts`). Add your own by implementing `Condition`.
 */
import type { Condition } from "./types.js";

/** Any notification, from any watcher. The default when none is given. */
export const anyActivity: Condition = { name: "any", matches: () => true };

/** Matches when any of the given conditions matches. */
export function anyOf<P>(...conditions: Condition<P>[]): Condition<P> {
  return {
    name: conditions.map((c) => c.name).join("|"),
    matches: (p) => conditions.some((c) => c.matches(p)),
  };
}

/** Matches when every given condition matches. */
export function allOf<P>(...conditions: Condition<P>[]): Condition<P> {
  return {
    name: conditions.map((c) => c.name).join("&"),
    matches: (p) => conditions.every((c) => c.matches(p)),
  };
}
