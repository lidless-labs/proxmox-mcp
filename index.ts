// NOTE: openclaw/plugin-sdk/plugin-entry's AnyAgentTool expects
// AgentToolResult<unknown> (with a `details` field), but our tool factories
// return MCP-shaped { content: [{ type: "text", text }] } results so the same
// tool objects can be served over the MCP stdio transport in mcp-server.ts.
// The runtime registration is duck-typed and works fine; we cast through
// `unknown` to bridge the intentional structural mismatch.
import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { resolveConfig, type ProxmoxConfig } from "./src/config.ts";
import { ProxmoxClient } from "./src/proxmox-client.ts";
import { execInLxc, execViaDirectSsh } from "./src/ssh-executor.ts";
import type { SshExecutor } from "./src/tools/_util.ts";
import { registerSecret, redact } from "./src/security.ts";
import * as tools from "./src/tools/index.ts";

interface ToolLike {
  name: string;
  execute: (id: string, args: Record<string, unknown>) => Promise<unknown>;
  [key: string]: unknown;
}

export function withRedactedErrors<T extends ToolLike>(tool: T): T {
  const orig = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (id: string, args: Record<string, unknown>) => {
      try {
        return await orig(id, args);
      } catch (e) {
        const msg = redact((e as Error).message) as string;
        return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
      }
    },
  };
}

function makeFactory(cfg: ProxmoxConfig) {
  registerSecret(cfg.tokenId);
  registerSecret(cfg.tokenSecret);
  registerSecret(`PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`);
  return () => new ProxmoxClient(cfg);
}

export default definePluginEntry({
  id: "proxmox",
  name: "Proxmox",
  description: "Proxmox VE control: status, container + VM lifecycle, snapshots, backups, recent tasks. Single-cluster, token auth, optional TLS-insecure. Tier-2 writes gated by confirm:true.",
  register(api) {
    if (api.registrationMode !== "full") return;
    const cfg = resolveConfig(process.env);
    const getClient = makeFactory(cfg);
    const hostCfg = { host: cfg.ssh.host, port: cfg.ssh.port, user: cfg.ssh.user, keyPath: cfg.ssh.keyPath };
    const getSsh = (): SshExecutor => ({
      execInLxc: (vmid, command, timeoutMs, stdin) => execInLxc(hostCfg, vmid, command, timeoutMs, stdin),
      execViaDirectSsh: (target, command, timeoutMs, stdin) => execViaDirectSsh(target, command, timeoutMs, stdin),
    });
    const vmDefaults = { vmUser: cfg.ssh.vmUser, vmKeyPath: cfg.ssh.vmKeyPath };
    const register = (t: ToolLike) => api.registerTool(withRedactedErrors(t) as unknown as AnyAgentTool);
    // Reads
    register(tools.createProxmoxStatusTool(getClient));
    register(tools.createProxmoxListContainersTool(getClient));
    register(tools.createProxmoxListVmsTool(getClient));
    register(tools.createProxmoxGetResourceTool(getClient));
    register(tools.createProxmoxGetVmConfigTool(getClient));
    register(tools.createProxmoxGetContainerConfigTool(getClient));
    register(tools.createProxmoxValidateQemuSmokeSourceTool(getClient));
    register(tools.createProxmoxAuditPermissionsTool(getClient));
    register(tools.createProxmoxRecentTasksTool(getClient));
    register(tools.createProxmoxListBackupsTool(getClient));
    register(tools.createProxmoxResourceUsageTool(getClient));
    register(tools.createProxmoxListTemplatesTool(getClient));
    register(tools.createProxmoxListStorageTool(getClient));
    register(tools.createProxmoxListSnapshotsTool(getClient));
    register(tools.createProxmoxGuestNetworkTool(getClient));
    register(tools.createProxmoxWaitTaskTool(getClient));
    register(tools.createProxmoxNextVmidTool(getClient));
    register(tools.createProxmoxListPoolResourcesTool(getClient));
    register(tools.createProxmoxGetTaskStatusTool(getClient));
    register(tools.createProxmoxGetTaskLogTool(getClient));
    register(tools.createProxmoxListStorageContentTool(getClient));
    register(tools.createProxmoxListNodeServicesTool(getClient));
    register(tools.createProxmoxListUpdatesTool(getClient));
    register(tools.createProxmoxListDisksTool(getClient));
    register(tools.createProxmoxListFirewallRulesTool(getClient));
    register(tools.createProxmoxGetFirewallOptionsTool(getClient));
    register(tools.createProxmoxListStorageConfigTool(getClient));
    register(tools.createProxmoxListBackupJobsTool(getClient));
    // Safe writes
    register(tools.createProxmoxStartResourceTool(getClient));
    register(tools.createProxmoxStopResourceTool(getClient));
    register(tools.createProxmoxRebootResourceTool(getClient));
    register(tools.createProxmoxSuspendResourceTool(getClient));
    register(tools.createProxmoxResumeResourceTool(getClient));
    register(tools.createProxmoxResetResourceTool(getClient));
    register(tools.createProxmoxSnapshotResourceTool(getClient));
    register(tools.createProxmoxRunBackupTool(getClient));
    register(tools.createProxmoxCreateContainerTool(getClient));
    register(tools.createProxmoxCreateVmTool(getClient));
    register(tools.createProxmoxCloneResourceTool(getClient));
    register(tools.createProxmoxConvertToTemplateTool(getClient));
    register(tools.createProxmoxUpdateVmConfigTool(getClient));
    register(tools.createProxmoxUpdateContainerConfigTool(getClient));
    register(tools.createProxmoxResizeDiskTool(getClient));
    register(tools.createProxmoxRestoreBackupTool(getClient));
    register(tools.createProxmoxMigrateResourceTool(getClient));
    register(tools.createProxmoxMoveDiskTool(getClient));
    register(tools.createProxmoxCreateStorageTool(getClient));
    register(tools.createProxmoxCreateBackupJobTool(getClient));
    register(tools.createProxmoxDeleteBackupJobTool(getClient));
    register(tools.createProxmoxDownloadUrlTool(getClient));
    register(tools.createProxmoxCancelTaskTool(getClient));
    register(tools.createProxmoxAddFirewallRuleTool(getClient));
    register(tools.createProxmoxDeleteFirewallRuleTool(getClient));
    register(tools.createProxmoxSetFirewallEnabledTool(getClient));
    // Guest SSH tools
    register(tools.createProxmoxExecTool(getClient, getSsh, vmDefaults));
    register(tools.createProxmoxReadFileTool(getClient, getSsh, vmDefaults));
    register(tools.createProxmoxWriteFileTool(getClient, getSsh, vmDefaults));
    register(tools.createProxmoxStatPathTool(getClient, getSsh, vmDefaults));
    register(tools.createProxmoxListDirectoryTool(getClient, getSsh, vmDefaults));
    register(tools.createProxmoxServiceStatusTool(getClient, getSsh, vmDefaults));
    register(tools.createProxmoxServiceStartTool(getClient, getSsh, vmDefaults));
    register(tools.createProxmoxServiceStopTool(getClient, getSsh, vmDefaults));
    register(tools.createProxmoxServiceRestartTool(getClient, getSsh, vmDefaults));
    // Destructive
    register(tools.createProxmoxRollbackSnapshotTool(getClient));
    register(tools.createProxmoxDestroyResourceTool(getClient));
    register(tools.createProxmoxCleanupSmokeResourcesTool(getClient));
    register(tools.createProxmoxDeleteSnapshotTool(getClient));
    register(tools.createProxmoxForceStopResourceTool(getClient));
    register(tools.createProxmoxDeleteVolumeTool(getClient));
    register(tools.createProxmoxNodePowerTool(getClient));
    register(tools.createProxmoxDeleteStorageTool(getClient));
  },
});
