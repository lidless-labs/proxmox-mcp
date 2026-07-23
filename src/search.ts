// Server-side search index for the dynamic-tool-loading pilot (Slice 1b). An agent
// calls a small discovery surface, gets back a handful of candidate tools, and only
// then loads the full typed schema for the one it wants.
//
// The search metadata (domain + keywords) lives HERE, server-side, and is NOT shipped
// in the visible tools/list descriptor. The measured token margin is only ~5 points
// (see scripts/measure-tool-tokens.ts), so putting keywords in the visible payload
// would erase it. Keywords are for retrieval scoring on the server, not for the client.

export type Domain =
  | "resources"
  | "storage"
  | "backups"
  | "firewall"
  | "identity"
  | "cluster"
  | "ha"
  | "guest-ops";

export const DOMAINS: readonly Domain[] = [
  "resources",
  "storage",
  "backups",
  "firewall",
  "identity",
  "cluster",
  "ha",
  "guest-ops",
] as const;

export interface ToolSearchMeta {
  domain: Domain;
  // Intent/synonym terms a user might phrase that the tool name and description do
  // not already contain. Authored blind to the benchmark so recall is not tuned to it.
  keywords: string[];
}

// One searchable record per tool, assembled from the descriptor (name, description)
// and its search metadata (domain, keywords).
export interface SearchRecord {
  name: string;
  description: string;
  domain: Domain;
  keywords: string[];
}

export interface SearchHit {
  name: string;
  score: number;
  domain: Domain;
}

// Words too common to carry retrieval signal. Intent verbs (list/show/get/create...)
// are deliberately NOT here: they match tool-name stems and are useful signal.
const STOPWORDS = new Set([
  "the", "a", "an", "of", "on", "in", "to", "and", "or", "for", "with", "me", "my",
  "is", "are", "it", "its", "that", "this", "at", "by", "from", "into", "then",
  "please", "all", "any", "some", "which", "what", "where", "how", "do", "does",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const stem = (name: string): string => name.replace(/^proxmox_/, "");

// Inverse document frequency across the tool corpus. A term that appears on many
// tools (guest, vm, resource, node) carries little signal about WHICH tool is meant;
// a rare term (snapshot, vzdump, acl, firewall) is highly discriminative. Weighting
// matches by IDF is the standard way to stop generic keywords from crowding the
// specific tool out of the top results. Computed from the index only, never the query
// set, so it does not tune to the benchmark.
export type IdfLookup = (term: string) => number;

export function buildIdf(index: SearchRecord[]): IdfLookup {
  const n = index.length;
  const df = new Map<string, number>();
  for (const rec of index) {
    const terms = new Set<string>([
      ...tokenize(stem(rec.name)),
      ...rec.keywords.flatMap((k) => tokenize(k)),
      ...tokenize(rec.description),
    ]);
    for (const t of terms) df.set(t, (df.get(t) ?? 0) + 1);
  }
  // Smoothed IDF, floored at 1 so a match always counts for something.
  return (term: string) => Math.max(1, Math.log((n + 1) / ((df.get(term) ?? 0) + 0.5)));
}

// Lexical scoring. Deterministic and explainable (the pilot calls for stable
// domains/tags plus free text, not embeddings). Base weights favor a curated keyword
// hit, then the tool-name stem, then the domain, then the description body; each match
// is scaled by the term's IDF so specific terms dominate generic ones.
export function scoreRecord(queryTerms: string[], rec: SearchRecord, idf: IdfLookup): number {
  if (queryTerms.length === 0) return 0;
  const keywordSet = new Set(rec.keywords.map((k) => k.toLowerCase()));
  const nameTokens = new Set(tokenize(stem(rec.name)));
  const descTokens = new Set(tokenize(rec.description));
  let score = 0;
  for (const term of queryTerms) {
    const w = idf(term);
    if (keywordSet.has(term)) score += 10 * w;
    else if ([...keywordSet].some((k) => k.includes(term) || term.includes(k))) score += 5 * w;
    if (nameTokens.has(term)) score += 6 * w;
    if (term === rec.domain || rec.domain.includes(term)) score += 2 * w;
    if (descTokens.has(term)) score += 3 * w;
  }
  return score;
}

export function buildSearchIndex(
  descriptors: Array<{ name: string; description: string }>,
  meta: Record<string, ToolSearchMeta>,
): SearchRecord[] {
  return descriptors.map((d) => {
    const m = meta[d.name];
    if (m === undefined) {
      throw new Error(`search: no search metadata (domain/keywords) for tool "${d.name}"`);
    }
    return { name: d.name, description: d.description, domain: m.domain, keywords: m.keywords };
  });
}

export interface SearchOptions {
  limit?: number;
  domain?: Domain; // optional hard filter to one domain
}

// A request can carry more than one intent ("snapshot X, then resize its disk").
// Splitting on the connectives that separate them lets a tool that is strong for
// EITHER intent rank on its own merits, instead of one combined bag-of-words diluting
// both. Single-intent queries yield one segment and score exactly as before.
function splitIntents(query: string): string[] {
  const parts = query
    .split(/\b(?:then|and)\b|[,;]+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [query];
}

export function searchTools(query: string, index: SearchRecord[], opts: SearchOptions = {}): SearchHit[] {
  const { limit = 5, domain } = opts;
  const segments = splitIntents(query).map(tokenize);
  const idf = buildIdf(index);
  const pool = domain ? index.filter((r) => r.domain === domain) : index;
  return pool
    .map((rec) => ({
      name: rec.name,
      // A tool's score is its best fit to any single intent, not the blurred whole.
      score: Math.max(...segments.map((terms) => scoreRecord(terms, rec, idf))),
      domain: rec.domain,
    }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// Populated by Slice 1b domain batches (Brigade seats). Every registered tool must
// have an entry; tests/search-coverage.test.ts asserts full coverage and valid domains.
export const TOOL_SEARCH_META: Record<string, ToolSearchMeta> = {
  "proxmox_add_firewall_rule": { domain: "firewall", keywords: ["allow", "block", "traffic", "ingress", "egress", "permit", "deny"] },
  "proxmox_add_ha_resource": { domain: "ha", keywords: ["protect", "failover", "availability", "fencing", "placement", "managed"] },
  "proxmox_audit_permissions": { domain: "identity", keywords: ["access", "rights", "privileges", "grants", "inspect", "who can"] },
  "proxmox_cancel_task": { domain: "cluster", keywords: ["abort", "terminate", "interrupt", "halt", "running", "job"] },
  "proxmox_cleanup_smoke_resources": { domain: "resources", keywords: ["purge", "leftovers", "testing", "preview", "dryrun", "tear down"] },
  "proxmox_clone_resource": { domain: "resources", keywords: ["copy", "duplicate", "fork", "instantiate", "source", "linked"] },
  "proxmox_cluster_log": { domain: "cluster", keywords: ["events", "history", "messages", "daemon", "entries", "audit"] },
  "proxmox_cluster_status": { domain: "cluster", keywords: ["membership", "quorum", "online", "health", "voting", "members"] },
  "proxmox_convert_to_template": { domain: "resources", keywords: ["golden", "image", "master", "reusable", "freeze", "base"] },
  "proxmox_create_backup_job": { domain: "backups", keywords: ["schedule", "vzdump", "nightly", "recurring", "automate", "retention"] },
  "proxmox_create_container": { domain: "resources", keywords: ["lxc", "provision", "instantiate", "deploy", "guest", "spin up"] },
  "proxmox_create_pool": { domain: "identity", keywords: ["group", "collection", "organize", "bucket", "membership", "grouping"] },
  "proxmox_create_replication": { domain: "ha", keywords: ["mirror", "synchronize", "failover", "remote", "target", "zfs"] },
  "proxmox_create_storage": { domain: "storage", keywords: ["datastore", "capacity", "backend", "attach", "volume", "define"] },
  "proxmox_create_token": { domain: "identity", keywords: ["apikey", "credential", "secret", "generate", "account", "auth"] },
  "proxmox_create_vm": { domain: "resources", keywords: ["qemu", "machine", "virtual", "provision", "guest", "spin up"] },
  "proxmox_delete_backup_job": { domain: "backups", keywords: ["unschedule", "remove", "recurring", "vzdump", "cancel", "nightly"] },
  "proxmox_delete_firewall_rule": { domain: "firewall", keywords: ["remove", "discard", "clear", "retract", "eliminate", "drop"] },
  "proxmox_delete_ha_resource": { domain: "ha", keywords: ["unmanage", "detach", "remove", "failover", "release", "availability"] },
  "proxmox_delete_pool": { domain: "identity", keywords: ["disband", "empty", "remove", "group", "collection", "tear down"] },
  "proxmox_delete_replication": { domain: "ha", keywords: ["unsync", "mirror", "cancel", "remove", "teardown", "stop"] },
  "proxmox_delete_snapshot": { domain: "resources", keywords: ["discard", "remove", "checkpoint", "recovery", "purge", "clear"] },
  "proxmox_delete_storage": { domain: "storage", keywords: ["detach", "unmount", "disconnect", "remove", "deprovision", "undefine"] },
  "proxmox_delete_token": { domain: "identity", keywords: ["revoke", "invalidate", "disable", "expire", "credential", "apikey"] },
  "proxmox_delete_volume": { domain: "storage", keywords: ["erase", "discard", "decommission", "archive", "image", "purge"] },
  "proxmox_destroy_resource": { domain: "resources", keywords: ["permanent", "decommission", "wipe", "remove", "guest", "delete"] },
  "proxmox_download_url": { domain: "storage", keywords: ["fetch", "installer", "checksum", "remote", "import", "iso"] },
  "proxmox_exec": { domain: "guest-ops", keywords: ["shell", "terminal", "command", "script", "stdout", "inside"] },
  "proxmox_force_stop_resource": { domain: "resources", keywords: ["hardkill", "emergency", "shutdown", "terminate", "poweroff", "kill"] },
  "proxmox_get_cluster_options": { domain: "cluster", keywords: ["datacenter", "settings", "keyboard", "migration", "defaults", "global"] },
  "proxmox_get_container_config": { domain: "resources", keywords: ["lxc", "settings", "hardware", "inspect", "properties", "show"] },
  "proxmox_get_firewall_options": { domain: "firewall", keywords: ["policy", "inbound", "outbound", "logging", "enabled", "default"] },
  "proxmox_get_resource": { domain: "resources", keywords: ["inspect", "guest", "details", "current", "health", "state"] },
  "proxmox_get_task_log": { domain: "cluster", keywords: ["tail", "output", "messages", "progress", "diagnose", "upid"] },
  "proxmox_get_task_status": { domain: "cluster", keywords: ["progress", "running", "completed", "exit", "operation", "upid"] },
  "proxmox_get_vm_config": { domain: "resources", keywords: ["qemu", "settings", "hardware", "inspect", "properties", "show"] },
  "proxmox_guest_network": { domain: "guest-ops", keywords: ["address", "interfaces", "ipvfour", "ethernet", "agent", "ip"] },
  "proxmox_ha_status": { domain: "ha", keywords: ["availability", "fencing", "quorum", "failover", "manager", "crm"] },
  "proxmox_list_acl": { domain: "identity", keywords: ["access", "entries", "grants", "bindings", "propagation", "permissions"] },
  "proxmox_list_backup_jobs": { domain: "backups", keywords: ["schedules", "vzdump", "automation", "retention", "archives", "recurring"] },
  "proxmox_list_backups": { domain: "backups", keywords: ["archives", "recovery", "copies", "vzdump", "restorepoints", "dumps"] },
  "proxmox_list_containers": { domain: "resources", keywords: ["lxc", "guests", "inventory", "workloads", "instances", "running"] },
  "proxmox_list_directory": { domain: "guest-ops", keywords: ["browse", "filesystem", "folder", "files", "enumerate", "inside"] },
  "proxmox_list_disks": { domain: "storage", keywords: ["drives", "smart", "wearout", "capacity", "hardware", "physical"] },
  "proxmox_list_firewall_rules": { domain: "firewall", keywords: ["policies", "filters", "traffic", "allow", "deny", "security"] },
  "proxmox_list_ha_resources": { domain: "ha", keywords: ["managed", "guests", "availability", "failover", "assignments", "protected"] },
  "proxmox_list_ha_rules": { domain: "ha", keywords: ["affinity", "placement", "constraints", "colocation", "preference", "policy"] },
  "proxmox_list_metric_servers": { domain: "cluster", keywords: ["monitoring", "telemetry", "influxdb", "graphite", "endpoints", "observability"] },
  "proxmox_list_node_services": { domain: "cluster", keywords: ["systemd", "daemons", "pveproxy", "pvedaemon", "corosync", "host"] },
  "proxmox_list_pool_resources": { domain: "identity", keywords: ["members", "grouping", "guests", "contents", "assignment", "belongs"] },
  "proxmox_list_pools": { domain: "identity", keywords: ["groups", "collections", "comments", "categories", "organization", "groupings"] },
  "proxmox_list_replication": { domain: "ha", keywords: ["mirroring", "synchronization", "failover", "source", "target", "sync jobs"] },
  "proxmox_list_roles": { domain: "identity", keywords: ["privileges", "rbac", "access", "permissions", "capabilities", "levels"] },
  "proxmox_list_sdn_vnets": { domain: "cluster", keywords: ["networks", "vlans", "overlays", "segments", "switches", "virtual"] },
  "proxmox_list_sdn_zones": { domain: "cluster", keywords: ["networks", "boundaries", "routing", "segments", "regions", "isolation"] },
  "proxmox_list_snapshots": { domain: "resources", keywords: ["checkpoints", "restorepoints", "history", "recovery", "savedstate", "rollback"] },
  "proxmox_list_storage": { domain: "storage", keywords: ["capacity", "free", "datastore", "space", "usage", "available"] },
  "proxmox_list_storage_config": { domain: "storage", keywords: ["datastores", "backends", "definitions", "shared", "restrictions", "setup"] },
  "proxmox_list_storage_content": { domain: "storage", keywords: ["volumes", "isos", "images", "archives", "templates", "files"] },
  "proxmox_list_templates": { domain: "storage", keywords: ["vztmpl", "isos", "images", "media", "bootable", "appliance"] },
  "proxmox_list_tokens": { domain: "identity", keywords: ["apikeys", "credentials", "secrets", "accounts", "authentication", "keys"] },
  "proxmox_list_updates": { domain: "cluster", keywords: ["patches", "packages", "upgrades", "apt", "outdated", "pending"] },
  "proxmox_list_users": { domain: "identity", keywords: ["accounts", "realms", "logins", "enabled", "access", "members"] },
  "proxmox_list_vms": { domain: "resources", keywords: ["qemu", "machines", "guests", "inventory", "workloads", "running"] },
  "proxmox_migrate_resource": { domain: "resources", keywords: ["relocate", "transfer", "live", "host", "rebalance", "move"] },
  "proxmox_move_disk": { domain: "storage", keywords: ["relocate", "volume", "backend", "transfer", "datastore", "reassign"] },
  "proxmox_next_vmid": { domain: "cluster", keywords: ["available", "identifier", "unused", "allocate", "number", "free"] },
  "proxmox_node_power": { domain: "cluster", keywords: ["reboot", "shutdown", "hypervisor", "restart", "host", "halt"] },
  "proxmox_read_file": { domain: "guest-ops", keywords: ["cat", "contents", "text", "document", "inspect", "inside"] },
  "proxmox_reboot_resource": { domain: "resources", keywords: ["restart", "cycle", "guest", "bounce", "powercycle", "graceful"] },
  "proxmox_recent_tasks": { domain: "cluster", keywords: ["activity", "history", "operations", "queue", "audit", "jobs"] },
  "proxmox_reset_resource": { domain: "resources", keywords: ["hardrestart", "button", "ungraceful", "reboot", "powercycle", "forced"] },
  "proxmox_resize_disk": { domain: "storage", keywords: ["grow", "expand", "increase", "capacity", "extend", "enlarge"] },
  "proxmox_resource_usage": { domain: "resources", keywords: ["metrics", "statistics", "cpu", "memory", "performance", "graphs"] },
  "proxmox_restore_backup": { domain: "backups", keywords: ["recover", "recreate", "overwrite", "vzdump", "archive", "revert"] },
  "proxmox_resume_resource": { domain: "resources", keywords: ["unpause", "continue", "wake", "thaw", "reawaken", "unfreeze"] },
  "proxmox_rollback_snapshot": { domain: "resources", keywords: ["revert", "undo", "previous", "checkpoint", "recover", "restore"] },
  "proxmox_run_backup": { domain: "backups", keywords: ["trigger", "vzdump", "archive", "save", "protect", "execute"] },
  "proxmox_service_restart": { domain: "guest-ops", keywords: ["systemd", "bounce", "reload", "daemon", "inside", "unit"] },
  "proxmox_service_start": { domain: "guest-ops", keywords: ["systemd", "launch", "boot", "daemon", "inside", "activate"] },
  "proxmox_service_status": { domain: "guest-ops", keywords: ["systemd", "running", "daemon", "health", "inside", "check"] },
  "proxmox_service_stop": { domain: "guest-ops", keywords: ["systemd", "halt", "kill", "daemon", "inside", "deactivate"] },
  "proxmox_set_acl": { domain: "identity", keywords: ["grant", "revoke", "permissions", "rights", "privileges", "assign"] },
  "proxmox_set_firewall_enabled": { domain: "firewall", keywords: ["toggle", "activate", "deactivate", "switch", "policy", "turn on"] },
  "proxmox_snapshot_resource": { domain: "resources", keywords: ["checkpoint", "capture", "freeze", "save", "restorepoint", "point in time"] },
  "proxmox_start_resource": { domain: "resources", keywords: ["boot", "poweron", "launch", "activate", "bringup", "turn on"] },
  "proxmox_stat_path": { domain: "guest-ops", keywords: ["metadata", "size", "permissions", "directory", "details", "exists"] },
  "proxmox_status": { domain: "cluster", keywords: ["version", "health", "nodes", "uptime", "overview", "summary"] },
  "proxmox_stop_resource": { domain: "resources", keywords: ["shutdown", "halt", "graceful", "poweroff", "deactivate", "turn off"] },
  "proxmox_suspend_resource": { domain: "resources", keywords: ["pause", "freeze", "sleep", "hibernate", "interrupt", "hold"] },
  "proxmox_update_container_config": { domain: "resources", keywords: ["edit", "modify", "lxc", "settings", "hostname", "cores"] },
  "proxmox_update_pool": { domain: "identity", keywords: ["modify", "members", "group", "comment", "detach", "edit"] },
  "proxmox_update_vm_config": { domain: "resources", keywords: ["edit", "modify", "qemu", "settings", "sockets", "cores"] },
  "proxmox_validate_qemu_smoke_source": { domain: "resources", keywords: ["verify", "safe", "clone", "agent", "passthrough", "readiness"] },
  "proxmox_wait_task": { domain: "cluster", keywords: ["poll", "monitor", "watch", "timeout", "complete", "block"] },
  "proxmox_write_file": { domain: "guest-ops", keywords: ["save", "upload", "text", "contents", "directories", "inside"] },
};
