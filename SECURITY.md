# Security Policy

## Supported versions

proxmox-mcp is WIP and pre-1.0. Only the latest published release on npm (`@solomonneas/proxmox-mcp`) and the `master` branch receive security fixes. Pin to a released version if you need a known-good build.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems. Email **me@solomonneas.dev** with: <!-- content-guard: allow pii/email -->

- A short description of the issue.
- Steps to reproduce (or a minimal proof of concept).
- The version or commit you tested against.
- Whether you would like to be credited in the release notes.

You should get an acknowledgment within 72 hours. If you do not, please follow up; the mail may have been filtered.

## This server can change and destroy infrastructure

proxmox-mcp exposes tools that boot, stop, reboot, snapshot, clone, create, and **permanently delete** VMs and LXC containers, and that run **arbitrary shell commands inside guests** (`proxmox_exec`, `proxmox_write_file`). Treat the running MCP process as something that holds the same authority as the Proxmox API token you give it, plus whatever your SSH key can reach.

The write-safety model is the primary security boundary you should understand and rely on:

- **Reads (tier 1)** are open and require no flag.
- **Gated guest reads and safe writes (tier 2)** require an explicit `confirm: true` argument on every call. A call without it throws `WriteGateError` before any HTTP traffic reaches Proxmox.
- **Destructive operations (tier 3)** require `confirm: true` + `destructive: true` **and** the process-level env flag `PROXMOX_ENABLE_DESTRUCTIVE=1`. All three gates must be satisfied. The five tools behind this gate are `proxmox_destroy_resource`, `proxmox_cleanup_smoke_resources`, `proxmox_rollback_snapshot`, `proxmox_delete_snapshot`, and `proxmox_force_stop_resource`.

The env flag exists so that a misbehaving or hallucinating model **cannot** delete or hard-stop a guest unless a human has deliberately turned the destructive gate on for the process. Leave `PROXMOX_ENABLE_DESTRUCTIVE` unset day to day. Set it only while you are actively doing teardown or smoke-test cycles, and unset it afterward.

## Token scope is your second boundary

The write gate protects you from the model. A least-privilege Proxmox API token protects you from everything else, including a compromised gate.

- Start with a **read-only token**: `Datastore.Audit` + `VM.Audit` + `Sys.Audit`. Confirm the read tools work end to end and that the redactor masks your secret in transcripts.
- Grade up to write privileges (`VM.PowerMgmt`, `VM.Snapshot`, `VM.Backup`) only after you trust the setup.
- Grant create/delete privileges only to a **scoped token bound to a dedicated pool** (the repo's `scripts/create-smoke-token.sh` does exactly this for smoke testing: a `McpSmokeRole`, an `mcp-smoke` pool, and ACLs limited to that pool plus specific storage).
- Tokens are tied to a PVE user and can be revoked instantly from Datacenter > Permissions > API Tokens. Revoke first, investigate second.

The token secret is registered with a redactor on startup and masked from all log and error output. Do not commit a token secret to any repo or paste it into an issue.

## SSH and TLS

- The in-guest exec tools SSH to the Proxmox host or directly to a VM using the key at `PROXMOX_SSH_KEY` (default `~/.ssh/id_ed25519`). That key's reach is part of this server's blast radius. Scope it.
- `PROXMOX_TLS_INSECURE=true` disables certificate validation and exists only for homelab self-signed certs. Leave it `false` anywhere a real CA-signed certificate is available.

## In scope

- A destructive tool executing without all three required gates satisfied (the gate failing open).
- A safe-write tool executing without `confirm: true`.
- Token secret, SSH key path, or other credential leaking into logs, error payloads, or tool output despite the redactor.
- Path traversal or injection in the guest exec / read / write / stat / list-directory tools.
- Any code path that lets a tool reach the Proxmox API or a guest beyond what its declared schema and tier allow.

## Out of scope

- Issues that require an attacker to already control the machine running the MCP, the MCP client config, or the Proxmox API token.
- Over-broad permissions on a token **you** chose to grant. The gate is a guardrail, not a substitute for least privilege.
- Bugs in Proxmox VE, the MCP client (Claude Desktop, Claude Code, OpenClaw, Codex CLI), or the MCP SDK; report those to their respective projects.
- Misconfiguration such as setting `PROXMOX_ENABLE_DESTRUCTIVE=1` and leaving it set, or pointing an unattended agent at a write-capable token.

## Disclosure

We aim to ship a fix within 14 days of confirming a valid report. A coordinated disclosure timeline can be negotiated for issues that need longer.
