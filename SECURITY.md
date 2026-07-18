# Security Policy

This project aligns with the security-reporting practices of the
[LF Decentralized Trust](https://lf-decentralized-trust.github.io/governance/governing-documents/SECURITY-POLICY)
ecosystem that the wider Hiero project follows.

## Reporting a vulnerability

Please **do not** open a public issue for anything you believe to be a
security vulnerability. Instead, use
[GitHub private vulnerability reporting](../../security/advisories/new)
("Report a vulnerability" under the repository's Security tab).

Include what you can: affected file/function, a proof-of-concept input, and
the impact you foresee. You will get an acknowledgement within a few days.

## Scope notes for reporters

Areas of this tool that are security-relevant by design and welcome
scrutiny:

- **Delivery targets** — webhook URLs and delivery configuration come from
  the operator's config; anything that lets a _watched account's on-chain
  data_ redirect, forge, or inject into a delivery would be a serious bug.
- **Rendered receipts** — receipts embed attacker-writable memo text;
  the rendering defenses live upstream in
  [hiero-receipts](https://github.com/hiero-hackers/hiero-receipts), but a
  bypass observable through this tool is reportable here too.
- **Config parsing** — `notify.config.json` and CLI flags are operator
  input, not attacker input, but confusion between the two is in scope.
