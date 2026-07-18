## What & why

<!-- One or two sentences: what changes, and what problem it solves. -->

## Checklist

- [ ] `npm run typecheck && npm run lint && npm run format:check && npm test` pass locally
- [ ] Every commit is signed off (`git commit -s` — the DCO check enforces this)
- [ ] New behavior is covered by a test
- [ ] Secrets never touch the repo — webhook URLs and keys live in `.env` / `notify.config.json` (both gitignored)
