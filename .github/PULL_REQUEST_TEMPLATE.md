<!--
Thanks for sending a patch. Keep this short; delete sections that do not apply.
See CONTRIBUTING.md for what lands easily and what needs an issue first.
-->

## What and why

<!-- One or two sentences on the user-visible change and the problem it solves. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New read tool
- [ ] New write or destructive tool (opened an issue first per CONTRIBUTING.md, and it ships with its gate)
- [ ] Safety hardening (schema, gate, redaction, error message)
- [ ] Docs
- [ ] Refactor with no tool-surface change

## Checklist

- [ ] `npm run typecheck` and `npm test` pass locally
- [ ] Any new state-changing tool has the correct gate (`confirm` for safe writes; `confirm` + `destructive` + `PROXMOX_ENABLE_DESTRUCTIVE` for destructive), and the README tool table + Safety section match
- [ ] Added or updated tests covering the change, including gate behavior
- [ ] Updated the `[Unreleased]` section of `CHANGELOG.md` for any user-visible effect
- [ ] No personal details, real hostnames, private IPs, node names, usernames, tokens, SSH keys, or unredacted absolute paths in code, tests, docs, or this PR (the `content-guard` hook will fail otherwise)
- [ ] Conventional commit messages, no AI co-authorship trailers
