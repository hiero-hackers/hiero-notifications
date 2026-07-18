# Test layout

Files mirror `src/` (a module's tests share its name; `watchers/` nests like
the source). Five layers, thinnest possible pyramid:

| Layer            | Files                                                                             | What it proves                                                                                     |
| ---------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Pure units       | `condition`, `state`, the diff half of `watchers/token`                           | Logic, no I/O                                                                                      |
| Seam integration | `watchers/account`, `watchers/token` (loop half), `watcher`, `replay`, `delivery` | Real modules + real fs against fake mirror / stubbed fetch — cursors, retry, dead-letter, catch-up |
| Process          | `cli`                                                                             | The real built bin, spawned: exit codes, usage, strict flags, replay                               |
| Artifact         | `scripts/pack-smoke.mjs` (`npm run test:pack`)                                    | The published tarball: exports resolve, bin runs                                                   |
| Docs drift       | `flags`, `examples-readme`                                                        | README ↔ code cannot desynchronize                                                                 |

**Live suite** (`npm run test:live`, `test/live/`): read-only checks against
the real mainnet mirror — shape drift the fakes cannot see. Deliberately
excluded from `npm test` and CI gates: the network's uptime must never fail
a PR. Run it before a release.

**Deliberately untested in CI, and why:**

- Real-network behavior in the default suite — see the live suite above.
- `src/cli.ts` v8 coverage — spawned processes are invisible to v8; the
  process layer covers its behavior (see `vitest.config.ts`).
- `examples/testnet-roundtrip.ts` — needs testnet keys and an unpublished
  sibling; its header explains.

Type safety for THIS directory comes from `tsconfig.examples.json`
(`npm run typecheck:examples`) — the main tsconfig covers `src/` only.
