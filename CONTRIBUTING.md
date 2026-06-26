# Contributing to proxmox-mcp

proxmox-mcp is an MCP server that gives an AI client a gated read/operate interface to a Proxmox VE cluster. It is WIP and pre-1.0, and patches are welcome. Before you start, please skim this file so we both spend time on the right things.

## What kinds of changes land easily

- **Bug fixes** in a tool handler, the Proxmox client, the SSH executor, the redactor, or the write gates.
- **Safety hardening**: a tighter schema, a missing gate, a clearer `WriteGateError` message, better redaction.
- **New read tools** that expose Proxmox state the model cannot already see.
- **Docs**: clearer setup for a specific MCP client, sharper safety wording, fixed examples.
- **Test coverage** for any of the above, especially gate behavior.

## What needs a conversation first

- **A new write or destructive tool.** Open an issue describing the user story and the gate it belongs in. The tier model is the project's main promise; new state-changing surface needs review.
- **Any change that loosens a gate** (moving a tool to a lower tier, making a confirm optional, weakening the destructive env flag). These need a strong justification.
- **Breaking changes** to tool names, argument schemas, or env var names. Clients and configs depend on them.

## What does not land

- **A destructive or safe-write tool without its gate.** Every tier-2 tool requires `confirm: true`; every tier-3 tool additionally requires `destructive: true` and the `PROXMOX_ENABLE_DESTRUCTIVE=1` process flag. A PR that adds a state-changing tool without the matching gate will not be merged.
- **Personal details in code, tests, or docs**: real hostnames, real private IPs, node names, usernames, account IDs, tokens, SSH keys, or unredacted absolute home paths. Use `192.0.2.x` (RFC 5737) and generic names like `pve1`. The `content-guard` pre-push hook will block these.
- **AI co-authorship trailers on commits** (`Co-Authored-By: <model>`). Conventional commits only.

## The safety model (read before touching a tool)

Every tool declares a tier, and the tier is enforced in `src/gates.ts` plus the per-tool schema, not just in docs:

- **Tier 1 read**: no flag.
- **Tier 2 gated read / safe write**: `confirm: true` required; `WriteGateError` fires before any HTTP call if it is missing.
- **Tier 3 destructive**: `confirm: true` + `destructive: true` + env `PROXMOX_ENABLE_DESTRUCTIVE=1`.

If your change adds or moves a tool, the tier and its gate must match the README tool table and the `Safety` section. Update both.

## Local dev

```bash
git clone https://github.com/lidless-labs/proxmox-mcp.git
cd proxmox-mcp
npm install
npm run typecheck
npm test
npm run build
```

`npm test` runs the unit suite (gate behavior, schema validation, redaction) with no live Proxmox. To exercise the real cluster, see the **Live smoke testing** section of the README; it uses a scoped smoke token and a dedicated pool so a mistake cannot touch your real guests.

## Filing issues

Please use the templates under `.github/ISSUE_TEMPLATE/`. Before posting output, remove tokens, SSH keys, real hostnames, private IPs, node names, and unredacted absolute paths. The most useful bug report includes the tool name, the arguments you passed (scrubbed), what you expected, and what happened.

## License

By contributing you agree that your contribution is licensed under the MIT License, same as the rest of the repo.
