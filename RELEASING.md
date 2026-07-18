# Releasing & operating this repo

The runbook for maintainers — everything that is not derivable from the code.

## One-time machine setup

GitHub Packages needs a `read:packages` token even for public packages:

```sh
gh auth refresh -s read:packages
npm config set //npm.pkg.github.com/:_authToken "$(gh auth token)"
```

(Re-run the second line if you ever re-login with `gh`.)

## One-time repo settings (after first push, in this order)

1. **Package access** — every `@hiero-hackers/*` package this repo's CI
   installs (`hiero-receipts`, `enterprise-mirror`, `streams-node`):
   package settings → _Manage Actions access_ → add this repo, Read.
   Until then the CI jobs that run `npm ci` fail with 401 — re-run after.
2. **Pages** — Settings → Pages → Source: _GitHub Actions_ (unblocks the
   API-docs deploy).
3. **Branch protection** on `main` requiring the CI checks and DCO — the
   gates only gate if they are required.
4. Optionally trigger the Scorecard workflow once so the badge populates.

## Cutting a release

```sh
# 1. bump "version" in package.json, land on main through a PR
# 2. tag the merge commit:
git switch main && git pull
git tag -s v0.1.1 -m "hiero-notifications 0.1.1"
git push origin v0.1.1
```

The tag push runs the gates and then publishes THREE artifacts:
npm package (GitHub Packages), container image
(`ghcr.io/hiero-hackers/hiero-notifications:{version,latest}`), and a GitHub
Release with auto-generated notes. The tag must equal `package.json`'s
version — a mismatch fails the guard instead of publishing.

**Re-run semantics:** jobs are independent and idempotent — a re-run
publishes whichever artifact is still missing and fails cleanly on what
already exists. A GitHub Release re-run is skipped if it exists.

## Before tagging

Run `npm run test:live` — read-only checks against the real mainnet mirror
(`test/live/`), catching upstream shape drift the CI fakes cannot see. It is
deliberately not a CI gate (network uptime must never fail a PR), which
makes it a release-time responsibility instead.

## Dependency policy

- Upstream `@hiero-hackers/*` deps are `^0.1.0` — pre-1.0, so caret allows
  patches only; a minor bump (possibly breaking) arrives as a Dependabot PR
  and must pass the full gates including `typecheck:examples` (the drift
  alarm against upstream types).
- **TypeScript majors are ignored by Dependabot on purpose** (see
  `.github/dependabot.yml`): the 7.x native compiler drops the JS API that
  typescript-eslint and typedoc load. Revisit when the toolchain supports it.
- The org intends an eventual **npmjs migration** (kills the token wall,
  enables OIDC provenance). When it happens: drop `publishConfig.registry`,
  claim the scope, keep GitHub Packages publishing during a transition.

## Maintenance notes

- **Coverage floors ratchet** (`vitest.config.ts`): when coverage rises,
  raise the floors to just under the new numbers. Never lower them silently.
- **Adding a CLI flag** is one row in `FLAG_SPECS` (flags.ts) plus its
  `argsToConfig` mapping — tests enforce that usage() and the README stay in
  sync.
- **Bumping `engines`**: also grep `.github/workflows` for hardcoded
  `node-version:` — Dependabot bumps actions, not these numbers.
- **State file `VERSION`**: read the migration policy comment in
  `src/state.ts` before bumping it.
- Cross-repo release order, when everything moves at once:
  `hiero-streams-rs` → `hiero-receipts` → this repo.
