import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { resolveConfig, type ProxmoxConfig } from "./config.ts";
import { ProxmoxClient } from "./proxmox-client.ts";
import { execInLxc, execViaDirectSsh } from "./ssh-executor.ts";
import { registerSecret, redact } from "./security.ts";
import type { SshExecutor } from "./tools/_util.ts";
import * as toolFactories from "./tools/index.ts";
import { classifyToolError } from "./errors.ts";
import { finalizeToolResult } from "./output.ts";
import { TOOL_TIERS, annotationsForTool } from "./registry.ts";
import { buildSearchIndex, TOOL_SEARCH_META } from "./search.ts";
import {
  createDeferredSession,
  deferredModeEnabled,
  runToolSearch,
  SEARCH_TOOL_DESCRIPTION,
  SEARCH_TOOL_NAME,
  searchToolParameters,
} from "./deferred.ts";

// A fresh server owns the deferred visible-tool set for exactly one MCP session.
export function createMcpServer(
  cfg: ProxmoxConfig = resolveConfig(process.env),
): Server {
registerSecret(cfg.tokenId);
registerSecret(cfg.tokenSecret);
registerSecret(`PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`);

const getClient = () => new ProxmoxClient(cfg);

const hostCfg = {
  host: cfg.ssh.host,
  port: cfg.ssh.port,
  user: cfg.ssh.user,
  hostFingerprint: cfg.ssh.hostFingerprint, keyPath: cfg.ssh.keyPath,
};
const getSsh = (): SshExecutor => ({
  execInLxc: (vmid, command, timeoutMs, stdin) => execInLxc(hostCfg, vmid, command, timeoutMs, stdin),
  execViaDirectSsh: (target, command, timeoutMs, stdin) => execViaDirectSsh(target, command, timeoutMs, stdin),
});
const vmDefaults = { vmUser: cfg.ssh.vmUser, vmKeyPath: cfg.ssh.vmKeyPath };

const tools = [
  toolFactories.createProxmoxStatusTool(getClient),
  toolFactories.createProxmoxListContainersTool(getClient),
  toolFactories.createProxmoxListVmsTool(getClient),
  toolFactories.createProxmoxGetResourceTool(getClient),
  toolFactories.createProxmoxGetVmConfigTool(getClient),
  toolFactories.createProxmoxGetContainerConfigTool(getClient),
  toolFactories.createProxmoxValidateQemuSmokeSourceTool(getClient),
  toolFactories.createProxmoxAuditPermissionsTool(getClient),
  toolFactories.createProxmoxRecentTasksTool(getClient),
  toolFactories.createProxmoxListBackupsTool(getClient),
  toolFactories.createProxmoxResourceUsageTool(getClient),
  toolFactories.createProxmoxStartResourceTool(getClient),
  toolFactories.createProxmoxStopResourceTool(getClient),
  toolFactories.createProxmoxRebootResourceTool(getClient),
  toolFactories.createProxmoxSnapshotResourceTool(getClient),
  toolFactories.createProxmoxRollbackSnapshotTool(getClient),
  toolFactories.createProxmoxRunBackupTool(getClient),
  toolFactories.createProxmoxGetTaskStatusTool(getClient),
  toolFactories.createProxmoxGetTaskLogTool(getClient),
  toolFactories.createProxmoxListTemplatesTool(getClient),
  toolFactories.createProxmoxListStorageTool(getClient),
  toolFactories.createProxmoxListSnapshotsTool(getClient),
  toolFactories.createProxmoxGuestNetworkTool(getClient),
  toolFactories.createProxmoxWaitTaskTool(getClient),
  toolFactories.createProxmoxNextVmidTool(getClient),
  toolFactories.createProxmoxListPoolResourcesTool(getClient),
  toolFactories.createProxmoxCreateContainerTool(getClient),
  toolFactories.createProxmoxCreateVmTool(getClient),
  toolFactories.createProxmoxCloneResourceTool(getClient),
  toolFactories.createProxmoxDestroyResourceTool(getClient),
  toolFactories.createProxmoxCleanupSmokeResourcesTool(getClient),
  toolFactories.createProxmoxDeleteSnapshotTool(getClient),
  toolFactories.createProxmoxForceStopResourceTool(getClient),
  toolFactories.createProxmoxExecTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxReadFileTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxWriteFileTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxStatPathTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxListDirectoryTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxServiceStatusTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxServiceStartTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxServiceStopTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxServiceRestartTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxUpdateVmConfigTool(getClient),
  toolFactories.createProxmoxUpdateContainerConfigTool(getClient),
  toolFactories.createProxmoxResizeDiskTool(getClient),
  toolFactories.createProxmoxRestoreBackupTool(getClient),
  toolFactories.createProxmoxMigrateResourceTool(getClient),
  toolFactories.createProxmoxSuspendResourceTool(getClient),
  toolFactories.createProxmoxResumeResourceTool(getClient),
  toolFactories.createProxmoxResetResourceTool(getClient),
  toolFactories.createProxmoxConvertToTemplateTool(getClient),
  toolFactories.createProxmoxListStorageContentTool(getClient),
  toolFactories.createProxmoxDownloadUrlTool(getClient),
  toolFactories.createProxmoxDeleteVolumeTool(getClient),
  toolFactories.createProxmoxListNodeServicesTool(getClient),
  toolFactories.createProxmoxListUpdatesTool(getClient),
  toolFactories.createProxmoxListDisksTool(getClient),
  toolFactories.createProxmoxCancelTaskTool(getClient),
  toolFactories.createProxmoxNodePowerTool(getClient),
  toolFactories.createProxmoxListFirewallRulesTool(getClient),
  toolFactories.createProxmoxGetFirewallOptionsTool(getClient),
  toolFactories.createProxmoxAddFirewallRuleTool(getClient),
  toolFactories.createProxmoxDeleteFirewallRuleTool(getClient),
  toolFactories.createProxmoxSetFirewallEnabledTool(getClient),
  toolFactories.createProxmoxMoveDiskTool(getClient),
  toolFactories.createProxmoxListStorageConfigTool(getClient),
  toolFactories.createProxmoxCreateStorageTool(getClient),
  toolFactories.createProxmoxDeleteStorageTool(getClient),
  toolFactories.createProxmoxListBackupJobsTool(getClient),
  toolFactories.createProxmoxCreateBackupJobTool(getClient),
  toolFactories.createProxmoxDeleteBackupJobTool(getClient),
  toolFactories.createProxmoxListUsersTool(getClient),
  toolFactories.createProxmoxListRolesTool(getClient),
  toolFactories.createProxmoxListAclTool(getClient),
  toolFactories.createProxmoxListPoolsTool(getClient),
  toolFactories.createProxmoxListTokensTool(getClient),
  toolFactories.createProxmoxSetAclTool(getClient),
  toolFactories.createProxmoxCreateTokenTool(getClient),
  toolFactories.createProxmoxDeleteTokenTool(getClient),
  toolFactories.createProxmoxCreatePoolTool(getClient),
  toolFactories.createProxmoxUpdatePoolTool(getClient),
  toolFactories.createProxmoxDeletePoolTool(getClient),
  toolFactories.createProxmoxClusterStatusTool(getClient),
  toolFactories.createProxmoxHaStatusTool(getClient),
  toolFactories.createProxmoxListHaResourcesTool(getClient),
  toolFactories.createProxmoxListHaRulesTool(getClient),
  toolFactories.createProxmoxListReplicationTool(getClient),
  toolFactories.createProxmoxListSdnZonesTool(getClient),
  toolFactories.createProxmoxListSdnVnetsTool(getClient),
  toolFactories.createProxmoxListMetricServersTool(getClient),
  toolFactories.createProxmoxGetClusterOptionsTool(getClient),
  toolFactories.createProxmoxClusterLogTool(getClient),
  toolFactories.createProxmoxAddHaResourceTool(getClient),
  toolFactories.createProxmoxDeleteHaResourceTool(getClient),
  toolFactories.createProxmoxCreateReplicationTool(getClient),
  toolFactories.createProxmoxDeleteReplicationTool(getClient),
];

const toolMap = new Map(tools.map((t) => [t.name, t]));

// Fail closed at startup if the access-tier registry and the registered tool set
// have drifted apart: every registered tool must declare a tier, and the registry
// must not name a tool that is not registered. This keeps a new tool from shipping
// without a tier (and thus without correct MCP safety annotations).
{
  const registered = new Set(tools.map((t) => t.name));
  const declared = new Set(Object.keys(TOOL_TIERS));
  const missing = [...registered].filter((n) => !declared.has(n));
  const extra = [...declared].filter((n) => !registered.has(n));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `registry/tool drift: missing tier for [${missing.join(", ")}]; ` +
        `tier declared for unregistered [${extra.join(", ")}]`,
    );
  }
}

// Deferred tool loading is opt-in. Off (the default), everything below behaves exactly
// as it did before: the full tool set is visible and no search tool exists. On, only
// proxmox_search_tools is visible at connect time and tools load per connection. See
// src/deferred.ts for the invariants, including why visibility is not a safety gate.
const deferred = deferredModeEnabled(process.env);
const session = deferred ? createDeferredSession() : null;
const searchIndex = deferred
  ? buildSearchIndex(
      tools.map((t) => ({ name: t.name, description: t.description })),
      TOOL_SEARCH_META,
    )
  : null;

if (toolMap.has(SEARCH_TOOL_NAME)) {
  throw new Error(`search tool name ${SEARCH_TOOL_NAME} collides with a registered tool`);
}

const server = new Server(
  { name: "proxmox-mcp", version: "0.12.0" },
  { capabilities: { tools: deferred ? { listChanged: true } : {} } },
);

const descriptorFor = (t: (typeof tools)[number]) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.parameters,
  annotations: annotationsForTool(t.name),
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (!deferred || session === null) return { tools: tools.map(descriptorFor) };
  return {
    tools: [
      {
        name: SEARCH_TOOL_NAME,
        description: SEARCH_TOOL_DESCRIPTION,
        inputSchema: searchToolParameters,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ...tools.filter((t) => session.isLoaded(t.name)).map(descriptorFor),
    ],
  };
});

// Error results are held to the same size limit and redaction as successful ones.
const errorResult = (payload: unknown) =>
  finalizeToolResult({ content: [{ type: "text", text: JSON.stringify(redact(payload)) }], isError: true });

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (deferred && session !== null && searchIndex !== null && req.params.name === SEARCH_TOOL_NAME) {
    try {
      const outcome = runToolSearch(
        (req.params.arguments ?? {}) as Record<string, unknown>,
        searchIndex,
        session,
      );
      // Only notify when the visible set actually changed, so a repeated search does
      // not make the client re-list for nothing.
      if (outcome.added.length > 0) await server.sendToolListChanged();
      return finalizeToolResult(outcome.result);
    } catch (e) {
      return errorResult(classifyToolError(e));
    }
  }

  const t = toolMap.get(req.params.name);
  if (!t) {
    return errorResult({
      error: `unknown tool: ${req.params.name}`,
      code: "UNKNOWN_TOOL",
      name: "UnknownToolError",
    });
  }
  // A direct call to a registered tool that search has not surfaced yet is honored, and
  // the tool is marked loaded so tools/list stays consistent with what the client just
  // used. Visibility is a token optimization; the executor's gates are the boundary.
  if (deferred && session !== null) session.load([t.name]);
  try {
    return finalizeToolResult(
      await t.execute(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>),
    );
  } catch (e) {
    return errorResult(classifyToolError(e));
  }
});

return server;
}

export async function startServer(): Promise<void> {
const server = createMcpServer();
const transport = new StdioServerTransport();
  // Strip the draft-07 `$schema` the MCP SDK stamps on tool schemas; Anthropic
  // rejects it ("must match JSON Schema draft 2020-12") when the full tool set
  // is sent, e.g. on subagent spawns. Intercept tools/list output here.
  const __send = transport.send.bind(transport);
  (transport as any).send = (message: any) => {
    const tools = message?.result?.tools;
    if (Array.isArray(tools)) {
      for (const t of tools) {
        if (t?.inputSchema) delete t.inputSchema.$schema;
        if (t?.outputSchema) delete t.outputSchema.$schema;
      }
    }
    return __send(message);
  };
await server.connect(transport);
}
