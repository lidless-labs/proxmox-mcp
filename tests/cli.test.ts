import { describe, it, expect, vi } from "vitest";
import { UsageError, parseArgs, run, type CliDeps } from "../cli.ts";
import type { ProxmoxClient } from "../src/proxmox-client.ts";

function capture(get: (path: string) => Promise<unknown>, serve = vi.fn().mockResolvedValue(undefined)) {
  const out: string[] = [];
  const err: string[] = [];
  const client = { get: vi.fn(get) } as unknown as ProxmoxClient;
  const deps: CliDeps = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    makeClient: () => client,
    serve,
  };
  return { out, err, deps, serve, client };
}

describe("parseArgs", () => {
  it("routes single and two-word commands", () => {
    expect(parseArgs(["status"])).toEqual({ kind: "run", command: "status", toolArgs: {}, json: false, health: true });
    expect(parseArgs(["vms", "list"])).toEqual({ kind: "run", command: "vms list", toolArgs: {}, json: false, health: false });
    expect(parseArgs(["next-vmid"])).toEqual({ kind: "run", command: "next-vmid", toolArgs: {}, json: false, health: false });
  });

  it("builds positional and flag args", () => {
    expect(parseArgs(["vm", "config", "100"])).toMatchObject({ command: "vm config", toolArgs: { vmid: 100 } });
    expect(parseArgs(["snapshots", "list", "100"])).toMatchObject({ command: "snapshots list", toolArgs: { vmid: 100 } });
    expect(parseArgs(["task", "log", "UPID:x", "--limit", "5"])).toMatchObject({ command: "task log", toolArgs: { upid: "UPID:x", limit: 5 } });
    expect(parseArgs(["backups", "list", "--node", "pve", "--vmid", "100"])).toMatchObject({
      command: "backups list",
      toolArgs: { node: "pve", vmid: 100 },
    });
    expect(parseArgs(["status", "--json"])).toMatchObject({ json: true });
  });

  it("routes help/version/mcp", () => {
    expect(parseArgs([])).toEqual({ kind: "help" });
    expect(parseArgs(["help"])).toEqual({ kind: "help" });
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseArgs(["mcp"])).toEqual({ kind: "mcp" });
  });

  it("rejects bad input with UsageError", () => {
    expect(() => parseArgs(["bogus"])).toThrow(UsageError);
    expect(() => parseArgs(["vm"])).toThrow(UsageError);
    expect(() => parseArgs(["vm", "config"])).toThrow(UsageError);
    expect(() => parseArgs(["vm", "config", "abc"])).toThrow(UsageError);
    expect(() => parseArgs(["task", "log"])).toThrow(UsageError);
  });

  it("routes the new read commands", () => {
    expect(parseArgs(["disks", "list", "--node", "pve"])).toMatchObject({ command: "disks list", toolArgs: { node: "pve" } });
    expect(parseArgs(["services", "list", "--node", "pve"])).toMatchObject({ command: "services list", toolArgs: { node: "pve" } });
    expect(parseArgs(["updates", "list", "--node", "pve"])).toMatchObject({ command: "updates list", toolArgs: { node: "pve" } });
    expect(parseArgs(["storage", "content", "local", "--node", "pve", "--content", "backup"])).toMatchObject({
      command: "storage content", toolArgs: { node: "pve", storage: "local", content: "backup" },
    });
    expect(parseArgs(["firewall", "rules", "--scope", "cluster"])).toMatchObject({ command: "firewall rules", toolArgs: { scope: "cluster" } });
    expect(parseArgs(["firewall", "options", "--scope", "guest", "--vmid", "100"])).toMatchObject({
      command: "firewall options", toolArgs: { scope: "guest", vmid: 100 },
    });
  });

  it("requires --node / --scope / positional storage on the new commands", () => {
    expect(() => parseArgs(["disks", "list"])).toThrow(UsageError);
    expect(() => parseArgs(["firewall", "rules"])).toThrow(UsageError);
    expect(() => parseArgs(["storage", "content", "--node", "pve"])).toThrow(UsageError);
  });
});

const NODES_ONLINE = async (path: string) => {
  if (path === "/version") return { version: "8.2.2", release: "8.2" };
  if (path.includes("type=node")) return [{ node: "pve", status: "online", cpu: 0.1 }];
  return [];
};

describe("run", () => {
  it("renders status and exits 0 when nodes are online", async () => {
    const { out, deps } = capture(NODES_ONLINE);
    expect(await run(["status"], deps)).toBe(0);
    expect(out.join("\n")).toContain("node=pve");
  });

  it("exits 1 when a node is offline", async () => {
    const { deps } = capture(async (path) => {
      if (path === "/version") return { version: "8.2.2" };
      if (path.includes("type=node")) return [{ node: "pve", status: "offline" }];
      return [];
    });
    expect(await run(["status"], deps)).toBe(1);
  });

  it("emits raw JSON with --json", async () => {
    const { out, deps } = capture(NODES_ONLINE);
    expect(await run(["status", "--json"], deps)).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.version).toBe("8.2.2");
    expect(parsed.nodes[0].node).toBe("pve");
  });

  it("lists vms via the read tool", async () => {
    const { out, deps, client } = capture(async () => [
      { vmid: 100, name: "web", node: "pve", status: "running", type: "qemu" },
    ]);
    expect(await run(["vms", "list"], deps)).toBe(0);
    expect((client.get as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("/cluster/resources?type=vm");
    expect(out.join("\n")).toContain("vmid=100");
  });

  it("returns exit 1 and a redacted message on client failure", async () => {
    const { err, deps } = capture(async () => {
      throw new Error("Proxmox unreachable: connect ECONNREFUSED");
    });
    expect(await run(["vms", "list"], deps)).toBe(1);
    expect(err.join("\n")).toContain("unreachable");
  });

  it("returns exit 2 and prints help on usage error", async () => {
    const { err, deps } = capture(NODES_ONLINE);
    expect(await run(["bogus"], deps)).toBe(2);
    expect(err.join("\n")).toContain("Usage:");
  });

  it("delegates mcp to serve()", async () => {
    const { deps, serve } = capture(NODES_ONLINE);
    expect(await run(["mcp"], deps)).toBe(0);
    expect(serve).toHaveBeenCalledOnce();
  });
});
