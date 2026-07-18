# Contributing to hiero-notifications

Thanks for considering a contribution! This project follows the practices of
the wider Hiero / LF Decentralized Trust ecosystem, including our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Development setup

Dependencies come from the GitHub Packages npm registry, which needs a
one-time `read:packages` token even for public packages:
`gh auth refresh -s read:packages`, then
`npm config set //npm.pkg.github.com/:_authToken "$(gh auth token)"`.

```sh
npm install
npm run typecheck   # tsc, strict
npm test            # vitest
npm run lint        # eslint (type-aware) + prettier as errors
npm run format      # prettier --write
npm run build       # emits dist/
```

All gates run in CI on every push and pull request — please run them locally
before opening a PR. Commits need a DCO sign-off (`git commit -s`).

## Ground rules

- **Secrets never touch the repo.** Webhook URLs, keys, and real configs
  live in `.env` / `notify.config.json` — both gitignored. The example
  config ships placeholders only.
- **Receipts are rendered upstream.** Wording, memo defenses, and money
  formatting belong to
  [hiero-receipts](https://github.com/hiero-hackers/hiero-receipts) — this
  project decides _when_ to deliver, not _what a receipt says_.
- **The watcher is polite.** Polling respects the mirror node: keyset
  cursors, bounded page sizes, no tight loops.

## Releasing (maintainers)

See [RELEASING.md](./RELEASING.md) — the full runbook: one-time settings,
tagging, what CI publishes, re-run semantics, and the dependency policy.
