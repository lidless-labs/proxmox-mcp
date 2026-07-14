# Changelog

All notable changes to proxmox-mcp are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.

> proxmox-mcp is WIP and pre-1.0. The latest published version is `0.11.0`; anything under `[Unreleased]` is in the repository but not yet in a tagged release.

## [Unreleased]

## [0.11.0] - 2026-07-14

Large control-surface expansion: 42 -> 96 tools across config-mutation, lifecycle, storage, node-ops, firewall, disk/storage management, access control, and cluster/HA/SDN, plus agent-UX ergonomics (task-await, guest-agent exec backend, CLI reads). Every new write was verified end-to-end against a live Proxmox VE 9.2 cluster except storage replication (needs a second node).

### Added

- **Cluster / HA / SDN observability** (tool surface 82 -> 96): `cluster_status`, `ha_status`, `list_ha_resources`, `list_ha_rules` (PVE 9+ replacement for HA groups), `list_replication`, `list_sdn_zones`, `list_sdn_vnets`, `list_metric_servers`, `get_cluster_options`, `cluster_log` (reads); `add_ha_resource`/`delete_ha_resource` and `create_replication`/`delete_replication` (Tier-2). Reads and the HA add/remove path verified live on a PVE 9.2 node; replication writes are fake-tested only (no second node available to replicate to). HA management requires a `Sys.Console` token.
- **Access control & pools** (tool surface 71 -> 82): `list_users`, `list_roles`, `list_acl`, `list_pools`, `list_tokens` (reads); `set_acl` (grant/revoke a role for a user/token/group on a path), `create_token`/`delete_token` (API tokens; create returns the secret once), and `create_pool`/`update_pool`/`delete_pool` (all Tier-2). Verified live on a PVE 9.2 cluster (pool create/update/delete, token create+delete round-trip, and an ACL grant removed via `set_acl`).
- **Disk & storage management** (tool surface 64 -> 71): `move_disk` (relocate a VM disk / container volume across storages, Tier-2 + wait), `list_storage_config`/`create_storage`/`delete_storage` (datacenter storage definitions; create Tier-2, delete Tier-3), and `list_backup_jobs`/`create_backup_job`/`delete_backup_job` (scheduled vzdump jobs; create/delete Tier-2). All verified live on a PVE 9.2 cluster (dir-storage create+delete, CT rootfs moved local-lvm -> dir storage, backup-job create/list/delete).
- **Task-await**: `wait: true` (+ optional `wait_timeout`, default 120s) on the nine long-running tools (create container/VM, clone, backup, restore, migrate, resize, download-url, destroy). The result then carries a `task` object with `done`/`exitstatus`/`ok`, so an agent can act on the outcome without a separate poll. Verified live (a WARNINGS exit correctly reports `ok:false`).
- **Guest-agent exec backend**: set `PROXMOX_EXEC_BACKEND=guest-agent` to run QEMU `exec`/`read_file`/`write_file`/`stat`/`list`/`service` tools through the qemu-guest-agent API instead of SSH - no in-guest SSH key or host-to-VM network path required (needs the token's `VM.GuestAgent.*` privileges). LXC still uses `pct exec` over host SSH. QEMU exec is centralized in one place so the backend choice is a single toggle. Verified live against a running VM (exec, file read, and file write round-trip).
- **CLI reads**: `proxmoxctl` gains `storage content`, `disks list`, `services list`, `updates list`, `firewall rules`, and `firewall options`. Still read-only.
- `ProxmoxClient` now encodes array body params as repeated keys (PVE's convention, e.g. the guest-agent `command` array).

### Added (control tools)

- **Lifecycle tools** (Tier-2): `proxmox_suspend_resource`, `proxmox_resume_resource`, `proxmox_reset_resource` (QEMU hard reset), and `proxmox_convert_to_template` (one-way).
- **Storage-plane tools**: `proxmox_list_storage_content` (Tier-1: browse ISOs/templates/images/backups), `proxmox_download_url` (Tier-2: fetch an ISO/template from a URL), and `proxmox_delete_volume` (Tier-3 destructive: prune a backup/ISO/image/disk).
- **Node-ops tools**: `proxmox_list_node_services`, `proxmox_list_disks` (SMART health), `proxmox_list_updates` (Tier-1 reads; `list_updates` needs a Sys.Modify token per Proxmox), `proxmox_cancel_task` (Tier-2: abort a running task), and `proxmox_node_power` (Tier-3 destructive: reboot/shutdown a whole node).
- **Firewall tools** across cluster/node/guest scope: `proxmox_list_firewall_rules`, `proxmox_get_firewall_options` (Tier-1 reads), and `proxmox_add_firewall_rule`, `proxmox_delete_firewall_rule`, `proxmox_set_firewall_enabled` (Tier-2 writes).
- **Config-mutation tools** (Tier-2 safe writes), closing the gap where the server could create and destroy guests but not modify existing ones:
  - `proxmox_update_vm_config` / `proxmox_update_container_config`: edit an existing guest's config (cores, memory, network, description, tags, etc.) via `PUT .../config`, with typed common fields plus a generic `set`/`unset` escape hatch for arbitrary keys.
  - `proxmox_resize_disk`: grow a VM or container disk (`PUT .../resize`, grow-only per Proxmox).
  - `proxmox_restore_backup`: restore a vzdump/PBS archive into a VMID. Restoring to a new VMID is Tier-2; overwriting an existing VMID escalates to the full destructive gate. (LXC restores correctly use the `ostemplate` field the PVE API expects.)
  - `proxmox_migrate_resource`: migrate a VM (online/live) or container (restart mode) to another node.
- `ProxmoxClient.put()` for PVE's config-mutation endpoints.
- Maintainer-health docs: `SECURITY.md` (destructive-op safety model and token-scope guidance), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and GitHub issue/PR templates.

### Changed

- Tool surface grows from 42 to 64 (reads 20->26, safe-writes 13->27, destructive 5->7). New writes verified end-to-end against a live Proxmox VE 9.2 cluster (config edit, resize, backup/restore round-trip, suspend/resume, convert-to-template, and the full firewall rule lifecycle at guest scope).
- OpenClaw plugin entry (`index.ts`) now registers the full tool set and wires guest SSH, matching the MCP stdio surface. It previously exposed only a stale 21-tool subset.
- README rewritten to the fleet adoption standard: differentiator-first opening, centered title and badges, prominent website link, a copyable MCP client config and the full verified tool list with explicit safety tiers, "Why not the alternatives?" and "What proxmox-mcp is not" sections. Real hosts and IPs in examples replaced with documentation-range placeholders (`192.0.2.x`).

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

- Published to npm (the last release before the 0.4.0 - 0.11.0 development cycle).
- Read, safe-write, and destructive tool tiers with the three-tier write gate.
- Token-secret redactor and TLS-insecure toggle for homelab self-signed certs.

## [0.2.0]

- Expanded tool coverage and gating.

## [0.1.0]

- Initial release: core read tools and the write-gating model.
