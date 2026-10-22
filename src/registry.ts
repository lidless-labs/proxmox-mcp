// Operation registry: the single typed surface every projection (MCP tools/list,
// the CLI, docs, benchmarks) reads from. This is Slice 1 of the dynamic-tool-
// loading pilot. It adds declarative metadata ALONGSIDE the existing tool
// descriptors without changing any executor or safety gate.
//
// SAFETY INVARIANT: the access tier below is a SECOND surface of a fact the
// executor already enforces through gates.ts (assertConfirmedWrite /
// assertDestructive / assertEnvFlag). It is descriptive metadata, never the
// enforcement point. A tool is safe because its executor calls the gate, not
// because this map labels it. `tests/registry-tier-consistency.test.ts` derives
// the tier independently from the executor source (following delegation into
// shared tool helpers) and fails if this map ever drifts from the real gate.

export type ToolTier = "read" | "safe-write" | "destructive";

// MCP tool annotations (hints only; clients must not rely on them for security).
// Clients that implement human-in-the-loop approval read destructiveHint to pick
// which calls need a human and readOnlyHint to skip approval on pure reads.
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

// Access tier per registered tool, keyed by the tool's MCP name. Derived from the
// confirmation gate each executor enforces:
//   read         -> no gate
//   safe-write   -> assertConfirmedWrite (includes confirm-gated guest reads and
//                   service actions that gate via src/tools/service-action.ts)
//   destructive  -> assertDestructive + assertEnvFlag(PROXMOX_ENABLE_DESTRUCTIVE)
// Counts: 43 read, 44 safe-write, 9 destructive (96 total).
export const TOOL_TIERS: Record<string, ToolTier> = {
  "proxmox_add_firewall_rule": "safe-write",
  "proxmox_add_ha_resource": "safe-write",
  "proxmox_audit_permissions": "read",
  "proxmox_cancel_task": "safe-write",
  "proxmox_cleanup_smoke_resources": "destructive",
  "proxmox_clone_resource": "safe-write",
  "proxmox_cluster_log": "read",
  "proxmox_cluster_status": "read",
  "proxmox_convert_to_template": "safe-write",
  "proxmox_create_backup_job": "safe-write",
  "proxmox_create_container": "safe-write",
  "proxmox_create_pool": "safe-write",
  "proxmox_create_replication": "safe-write",
  "proxmox_create_storage": "safe-write",
  "proxmox_create_token": "safe-write",
  "proxmox_create_vm": "safe-write",
  "proxmox_delete_backup_job": "safe-write",
  "proxmox_delete_firewall_rule": "safe-write",
  "proxmox_delete_ha_resource": "safe-write",
  "proxmox_delete_pool": "safe-write",
  "proxmox_delete_replication": "safe-write",
  "proxmox_delete_snapshot": "destructive",
  "proxmox_delete_storage": "destructive",
  "proxmox_delete_token": "safe-write",
  "proxmox_delete_volume": "destructive",
  "proxmox_destroy_resource": "destructive",
  "proxmox_download_url": "safe-write",
  "proxmox_exec": "safe-write",
  "proxmox_force_stop_resource": "destructive",
  "proxmox_get_cluster_options": "read",
  "proxmox_get_container_config": "read",
  "proxmox_get_firewall_options": "read",
  "proxmox_get_resource": "read",
  "proxmox_get_task_log": "read",
  "proxmox_get_task_status": "read",
  "proxmox_get_vm_config": "read",
  "proxmox_guest_network": "read",
  "proxmox_ha_status": "read",
  "proxmox_list_acl": "read",
  "proxmox_list_backup_jobs": "read",
  "proxmox_list_backups": "read",
  "proxmox_list_containers": "read",
  "proxmox_list_directory": "safe-write",
  "proxmox_list_disks": "read",
  "proxmox_list_firewall_rules": "read",
  "proxmox_list_ha_resources": "read",
  "proxmox_list_ha_rules": "read",
  "proxmox_list_metric_servers": "read",
  "proxmox_list_node_services": "read",
  "proxmox_list_pool_resources": "read",
  "proxmox_list_pools": "read",
  "proxmox_list_replication": "read",
  "proxmox_list_roles": "read",
  "proxmox_list_sdn_vnets": "read",
  "proxmox_list_sdn_zones": "read",
  "proxmox_list_snapshots": "read",
  "proxmox_list_storage_config": "read",
  "proxmox_list_storage_content": "read",
  "proxmox_list_storage": "read",
  "proxmox_list_templates": "read",
  "proxmox_list_tokens": "read",
  "proxmox_list_updates": "read",
  "proxmox_list_users": "read",
  "proxmox_list_vms": "read",
  "proxmox_migrate_resource": "safe-write",
  "proxmox_move_disk": "safe-write",
  "proxmox_next_vmid": "read",
  "proxmox_node_power": "destructive",
  "proxmox_read_file": "safe-write",
  "proxmox_reboot_resource": "safe-write",
  "proxmox_recent_tasks": "read",
  "proxmox_reset_resource": "safe-write",
  "proxmox_resize_disk": "safe-write",
  "proxmox_resource_usage": "read",
  "proxmox_restore_backup": "destructive",
  "proxmox_resume_resource": "safe-write",
  "proxmox_rollback_snapshot": "destructive",
  "proxmox_run_backup": "safe-write",
  "proxmox_service_restart": "safe-write",
  "proxmox_service_start": "safe-write",
  "proxmox_service_status": "safe-write",
  "proxmox_service_stop": "safe-write",
  "proxmox_set_acl": "safe-write",
  "proxmox_set_firewall_enabled": "safe-write",
  "proxmox_snapshot_resource": "safe-write",
  "proxmox_start_resource": "safe-write",
  "proxmox_stat_path": "safe-write",
  "proxmox_status": "read",
  "proxmox_stop_resource": "safe-write",
  "proxmox_suspend_resource": "safe-write",
  "proxmox_update_container_config": "safe-write",
  "proxmox_update_pool": "safe-write",
  "proxmox_update_vm_config": "safe-write",
  "proxmox_validate_qemu_smoke_source": "read",
  "proxmox_wait_task": "read",
  "proxmox_write_file": "safe-write",
};

// MCP annotations projected from the access tier. Kept as a pure function of the
// tier so the baseline can never disagree with it.
export function annotationsForTier(tier: ToolTier): ToolAnnotations {
  switch (tier) {
    case "read":
      return { readOnlyHint: true };
    case "safe-write":
      return { readOnlyHint: false, destructiveHint: false };
    case "destructive":
      return { readOnlyHint: false, destructiveHint: true };
  }
}

// The access tier says which gate arguments a call must carry. It does not say how
// disruptive the call is: a safe-write tool can still run a command in a guest, stop a
// workload, revoke a credential or change permissions. Clients that ask a person before
// running a tool key on destructiveHint being exactly true, so the tools below carry the
// hint while keeping the gate they enforce. Moving them to the destructive tier instead
// would change the gate arguments every caller has to send.
export const DESTRUCTIVE_HINT_TOOLS: ReadonlySet<string> = new Set([
  "proxmox_cancel_task",
  "proxmox_convert_to_template",
  "proxmox_create_token",
  "proxmox_delete_backup_job",
  "proxmox_delete_firewall_rule",
  "proxmox_delete_ha_resource",
  "proxmox_delete_pool",
  "proxmox_delete_replication",
  "proxmox_delete_token",
  "proxmox_download_url",
  "proxmox_exec",
  "proxmox_migrate_resource",
  "proxmox_move_disk",
  "proxmox_reboot_resource",
  "proxmox_reset_resource",
  "proxmox_resize_disk",
  "proxmox_service_restart",
  "proxmox_service_stop",
  "proxmox_set_acl",
  "proxmox_set_firewall_enabled",
  "proxmox_stop_resource",
  "proxmox_suspend_resource",
  "proxmox_update_container_config",
  "proxmox_update_pool",
  "proxmox_update_vm_config",
  "proxmox_write_file",
]);

// Guest reads sit behind confirm:true because they reach into a guest over SSH, but they
// change nothing, so they are reported read-only.
export const READ_ONLY_HINT_TOOLS: ReadonlySet<string> = new Set([
  "proxmox_list_directory",
  "proxmox_read_file",
  "proxmox_service_status",
  "proxmox_stat_path",
]);

// Repeating the call with the same arguments has no further effect.
export const IDEMPOTENT_HINT_TOOLS: ReadonlySet<string> = new Set([
  "proxmox_delete_backup_job",
  "proxmox_delete_ha_resource",
  "proxmox_delete_pool",
  "proxmox_delete_replication",
  "proxmox_delete_token",
  "proxmox_resume_resource",
  "proxmox_service_start",
  "proxmox_service_stop",
  "proxmox_set_acl",
  "proxmox_set_firewall_enabled",
  "proxmox_start_resource",
  "proxmox_stop_resource",
  "proxmox_suspend_resource",
]);

// The tool reaches a host outside the Proxmox cluster.
export const OPEN_WORLD_HINT_TOOLS: ReadonlySet<string> = new Set(["proxmox_download_url"]);

// Annotations reported in tools/list for a registered tool: the tier baseline plus the
// hint sets above. A hint set can only raise the warning level (destructive) or mark a
// confirm-gated guest read as read-only; it never changes the tier or the gate.
export function annotationsForTool(name: string): ToolAnnotations {
  const annotations = annotationsForTier(tierForTool(name));
  if (annotations.readOnlyHint !== true && DESTRUCTIVE_HINT_TOOLS.has(name)) {
    annotations.destructiveHint = true;
  }
  if (READ_ONLY_HINT_TOOLS.has(name)) {
    return { readOnlyHint: true };
  }
  if (annotations.readOnlyHint === true) return annotations;
  if (IDEMPOTENT_HINT_TOOLS.has(name)) annotations.idempotentHint = true;
  if (OPEN_WORLD_HINT_TOOLS.has(name)) annotations.openWorldHint = true;
  return annotations;
}

// Look up the tier for a registered tool. Throws when the name is absent so a
// newly added tool cannot ship without a declared tier (mcp-server asserts full
// coverage at startup, and the consistency test asserts the map is exactly the
// registered set).
export function tierForTool(name: string): ToolTier {
  const tier = TOOL_TIERS[name];
  if (tier === undefined) {
    throw new Error(`registry: no access tier declared for tool "${name}"`);
  }
  return tier;
}
