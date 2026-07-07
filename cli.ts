import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ProxmoxClient } from "./src/proxmox-client.ts";
import { resolveConfig } from "./src/config.ts";
import { redact } from "./src/security.ts";
import { startServer } from "./mcp-server.ts";
import * as proxmoxTools from "./src/tools/index.ts";
import pkg from "./package.json" with { type: "json" };

export class UsageError extends Error {}

type ClientFactory = () => ProxmoxClient;
interface ReadTool {
  execute: (id: string, raw: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;
}
type ToolCreator = (gc: ClientFactory) => ReadTool;
type Flags = Record<string, string | true>;

interface CommandSpec {
  create: ToolCreator;
  build: (positionals: string[], flags: Flags) => Record<string, unknown>;
  health?: boolean;
}

// Only read/report tools are wired here, so the CLI cannot reach any
// mutating/destructive Proxmox operation. Writes stay in the MCP server.
const COMMANDS: Record<string, CommandSpec> = {
  status: { create: proxmoxTools.createProxmoxStatusTool, build: () => ({}), health: true },
  "vms list": { create: proxmoxTools.createProxmoxListVmsTool, build: () => ({}) },
  "containers list": { create: proxmoxTools.createProxmoxListContainersTool, build: () => ({}) },
  "vm config": { create: proxmoxTools.createProxmoxGetVmConfigTool, build: (p) => ({ vmid: reqInt(p[0], "vmid") }) },
  "container config": { create: proxmoxTools.createProxmoxGetContainerConfigTool, build: (p) => ({ vmid: reqInt(p[0], "vmid") }) },
  "resource get": { create: proxmoxTools.createProxmoxGetResourceTool, build: (p) => ({ vmid: reqInt(p[0], "vmid") }) },
  "resource usage": {
    create: proxmoxTools.createProxmoxResourceUsageTool,
    build: (p, f) => strip({ vmid: p[0] !== undefined ? reqInt(p[0], "vmid") : undefined, timeframe: flagStr(f, "timeframe") }),
  },
  "storage list": { create: proxmoxTools.createProxmoxListStorageTool, build: (_p, f) => strip({ node: flagStr(f, "node") }) },
  "backups list": {
    create: proxmoxTools.createProxmoxListBackupsTool,
    build: (_p, f) => strip({ node: flagStr(f, "node"), vmid: flagInt(f, "vmid") }),
  },
  "snapshots list": { create: proxmoxTools.createProxmoxListSnapshotsTool, build: (p) => ({ vmid: reqInt(p[0], "vmid") }) },
  "templates list": {
    create: proxmoxTools.createProxmoxListTemplatesTool,
    build: (_p, f) => strip({ node: flagStr(f, "node"), storage: flagStr(f, "storage"), kind: flagStr(f, "kind") }),
  },
  "pool-resources": { create: proxmoxTools.createProxmoxListPoolResourcesTool, build: (p, f) => strip({ pool: p[0] ?? flagStr(f, "pool") }) },
  "audit-permissions": { create: proxmoxTools.createProxmoxAuditPermissionsTool, build: (_p, f) => strip({ pool: flagStr(f, "pool") }) },
  "task log": {
    create: proxmoxTools.createProxmoxGetTaskLogTool,
    build: (p, f) => strip({ upid: reqStr(p[0], "upid"), limit: flagInt(f, "limit"), start: flagInt(f, "start") }),
  },
  "task status": { create: proxmoxTools.createProxmoxGetTaskStatusTool, build: (p) => ({ upid: reqStr(p[0], "upid") }) },
  "recent-tasks": { create: proxmoxTools.createProxmoxRecentTasksTool, build: (_p, f) => strip({ limit: flagInt(f, "limit"), vmid: flagInt(f, "vmid") }) },
  "next-vmid": { create: proxmoxTools.createProxmoxNextVmidTool, build: () => ({}) },
  "guest-network": { create: proxmoxTools.createProxmoxGuestNetworkTool, build: (p) => ({ vmid: reqInt(p[0], "vmid") }) },
};

const TWO_WORD = new Set(["vms", "containers", "vm", "container", "resource", "storage", "backups", "snapshots", "templates", "task"]);

export const HELP = `proxmoxctrl - read-only Proxmox VE control CLI (aliases: proxmoxctl, proxops; MCP adapter: proxmox-mcp)

Usage:
  proxmoxctrl <command> [options]

Inventory:
  status                       PVE version + per-node status (exit 1 if a node is offline)
  vms list                     QEMU VMs across the cluster
  containers list              LXC containers across the cluster
  vm config <vmid>             Config of a QEMU VM
  container config <vmid>      Config of an LXC container
  resource get <vmid>          Cluster resource summary for a guest
  resource usage [<vmid>]      RRD usage [--timeframe hour|day|week|month|year]
  storage list                 Storage status [--node <node>]
  backups list                 Backup volumes [--node <node>] [--vmid <id>]
  snapshots list <vmid>        Snapshots of a guest
  templates list               CT/VM templates [--node] [--storage] [--kind ct|vm]
  pool-resources [<pool>]      Members of a resource pool
  next-vmid                    Next free VMID
  guest-network <vmid>         LXC network interfaces

Audit / tasks:
  audit-permissions            Token privilege audit on common paths [--pool <pool>]
  recent-tasks                 Recent cluster tasks [--limit <n>] [--vmid <id>]
  task status <upid>           Status of a task
  task log <upid>              Log of a task [--limit <n>] [--start <n>]

Server:
  mcp                          Start the MCP server over stdio
  help                         Show this help

Global options:
  --json                       Emit raw JSON instead of the summary view
  --version, -v                Print version
  --help, -h                   Show help

Environment:
  PROXMOX_URL, PROXMOX_TOKEN_ID, PROXMOX_TOKEN_SECRET, PROXMOX_TLS_INSECURE

This CLI is read-only. Lifecycle, snapshot, backup, and exec operations stay in the MCP server.`;

function reqInt(v: string | undefined, name: string): number {
  if (v === undefined) throw new UsageError(`${name} is required`);
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${name} must be a non-negative integer`);
  return n;
}

function reqStr(v: string | undefined, name: string): string {
  if (v === undefined || v === "") throw new UsageError(`${name} is required`);
  return v;
}

function flagStr(flags: Flags, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

function flagInt(flags: Flags, name: string): number | undefined {
  const v = flagStr(flags, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new UsageError(`--${name} must be an integer`);
  return n;
}

function strip(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function takeFlag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

export type Parsed =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "mcp" }
  | { kind: "run"; command: string; toolArgs: Record<string, unknown>; json: boolean; health: boolean };

export function parseArgs(argv: string[]): Parsed {
  const args = [...argv];
  if (args.includes("-h") || args.includes("--help")) return { kind: "help" };
  if (args.includes("-v") || args.includes("--version")) return { kind: "version" };
  const json = takeFlag(args, "--json");

  const tokens: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      tokens.push(a);
    }
  }

  const first = tokens[0];
  if (!first || first === "help") return { kind: "help" };
  if (first === "mcp") return { kind: "mcp" };

  let command: string;
  let positionals: string[];
  if (TWO_WORD.has(first)) {
    const second = tokens[1];
    if (!second) throw new UsageError(`incomplete command: "${first}" needs a subcommand`);
    command = `${first} ${second}`;
    positionals = tokens.slice(2);
  } else {
    command = first;
    positionals = tokens.slice(1);
  }

  const spec = COMMANDS[command];
  if (!spec) throw new UsageError(`unknown command: ${command}`);
  return { kind: "run", command, toolArgs: spec.build(positionals, flags), json, health: !!spec.health };
}

function nodesHealthy(data: unknown): boolean {
  if (!data || typeof data !== "object") return true;
  const nodes = (data as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return true;
  return nodes.every((n) => (n as Record<string, unknown>)?.status === "online");
}

function summarize(item: unknown): string {
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    const keys = ["vmid", "name", "node", "status", "type", "storage", "content", "volid", "size", "upid", "starttime", "snapname", "pool"].filter(
      (k) => k in o,
    );
    if (keys.length) return keys.map((k) => `${k}=${String(o[k])}`).join("  ");
    return JSON.stringify(o);
  }
  return String(item);
}

function render(data: unknown): string {
  if (Array.isArray(data)) {
    return [`${data.length} item(s):`, ...data.map((it) => `  ${summarize(it)}`)].join("\n");
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const arrKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    if (arrKey) {
      const arr = obj[arrKey] as unknown[];
      const head = Object.entries(obj)
        .filter(([k, v]) => k !== arrKey && (typeof v !== "object" || v === null))
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ");
      const heading = `${arr.length} ${arrKey}${head ? `  (${head})` : ""}:`;
      return [heading, ...arr.map((it) => `  ${summarize(it)}`)].join("\n");
    }
  }
  return JSON.stringify(data, null, 2);
}

export interface CliDeps {
  out: (s: string) => void;
  err: (s: string) => void;
  makeClient: () => ProxmoxClient;
  serve: () => Promise<void>;
}

export async function run(argv: string[], deps: CliDeps): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    deps.err(error instanceof Error ? error.message : String(error));
    deps.err("");
    deps.err(HELP);
    return 2;
  }

  if (parsed.kind === "help") {
    deps.out(HELP);
    return 0;
  }
  if (parsed.kind === "version") {
    deps.out(pkg.version);
    return 0;
  }
  if (parsed.kind === "mcp") {
    await deps.serve();
    return 0;
  }

  try {
    const client = deps.makeClient();
    const spec = COMMANDS[parsed.command];
    const tool = spec.create(() => client);
    const result = await tool.execute("cli", parsed.toolArgs);
    const data = JSON.parse(result.content[0].text);
    deps.out(parsed.json ? JSON.stringify(data) : render(data));
    if (parsed.health && !nodesHealthy(data)) return 1;
    return 0;
  } catch (error) {
    deps.err(String(redact(error instanceof Error ? error.message : String(error))));
    return 1;
  }
}

// True when this module is the process entrypoint (symlink-safe).
const isEntrypoint = (() => {
  const arg = process.argv[1];
  if (typeof arg !== "string") return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  run(process.argv.slice(2), {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    makeClient: () => new ProxmoxClient(resolveConfig(process.env)),
    serve: startServer,
  })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
