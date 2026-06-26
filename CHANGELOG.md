# Changelog

All notable changes to proxmox-mcp are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.

> proxmox-mcp is WIP and pre-1.0. The latest version published to npm is `0.3.0`; later entries below describe work that is in the repository ahead of the npm release.

## [Unreleased]

### Added

- Maintainer-health docs: `SECURITY.md` (destructive-op safety model and token-scope guidance), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and GitHub issue/PR templates.

### Changed

- README rewritten to the fleet adoption standard: differentiator-first opening, centered title and badges, prominent website link, a copyable MCP client config and the full verified 42-tool list with explicit safety tiers, "Why not the alternatives?" and "What proxmox-mcp is not" sections. Real hosts and IPs in examples replaced with documentation-range placeholders (`192.0.2.x`).

## [0.5.0]

- Add effective permission audit tooling for smoke-token ACL checks.
- Add structured MCP error payloads with stable `code` fields.
- Add snapshot rollback tooling and optional live rollback smoke.
- Add optional live backup smoke that waits for vzdump and verifies the backup artifact is listed.
- Harden live QEMU smoke with source validation, guest-network waiting, and cleanup stop-before-destroy behavior.
- Harden smoke cleanup with `dry_run: true` by default, delete-task waiting, and running-guest skips unless `force: true`.

## [0.4.0]

- Add in-guest tools (`proxmox_exec`, `proxmox_read_file`, `proxmox_write_file`, `proxmox_stat_path`, `proxmox_list_directory`) over SSH, with `pct exec` for LXC and direct SSH for QEMU.
- Add systemd service tools (`proxmox_service_status`, `proxmox_service_start`, `proxmox_service_stop`, `proxmox_service_restart`) gated behind `confirm: true`.
- Add per-VM SSH overrides read at execute time.

## [0.3.0]

- Latest release published to npm.
- Read, safe-write, and destructive tool tiers with the three-tier write gate.
- Token-secret redactor and TLS-insecure toggle for homelab self-signed certs.

## [0.2.0]

- Expanded tool coverage and gating.

## [0.1.0]

- Initial release: core read tools and the write-gating model.
