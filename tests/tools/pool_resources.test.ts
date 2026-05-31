import { describe, it, expect, afterEach, vi } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxCleanupSmokeResourcesTool } from "../../src/tools/proxmox_cleanup_smoke_resources.ts";
import { createProxmoxListPoolResourcesTool } from "../../src/tools/proxmox_list_pool_resources.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
  vi.unstubAllEnvs();
});

function mkClient() {
  return new ProxmoxClient({
    url: fake!.baseUrl,
    tokenId: "u@pam!t",
    tokenSecret: "s",
    tlsInsecure: false,
  });
}

describe("pool resource tools", () => {
  it("lists pool resources with count", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/pools/mcp-smoke",
        status: 200,
        body: {
          data: {
            poolid: "mcp-smoke",
            comment: "smoke resources",
            members: [
              { type: "lxc", vmid: 102, node: "pve", name: "mcp-smoke-102", status: "stopped" },
              { type: "qemu", vmid: 202, node: "pve", name: "mcp-smoke-qemu-202", status: "stopped" },
            ],
          },
        },
      },
    ]);
    const tool = createProxmoxListPoolResourcesTool(() => mkClient());
    const r = await tool.execute("test", {});
    const payload = JSON.parse(r.content[0].text);
    expect(payload.pool).toBe("mcp-smoke");
    expect(payload.count).toBe(2);
    expect(payload.resources[0].vmid).toBe(102);
  });

  it("refuses cleanup without the destructive env gate", async () => {
    fake = await startFakeProxmox([]);
    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "");
    const tool = createProxmoxCleanupSmokeResourcesTool(() => mkClient());
    await expect(
      tool.execute("test", { confirm: true, destructive: true }),
    ).rejects.toThrow(WriteGateError);
    expect(fake.requests).toHaveLength(0);
  });

  it("destroys only pool members with the smoke name prefix", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/pools/mcp-smoke",
        status: 200,
        body: {
          data: {
            members: [
              { type: "lxc", vmid: 102, node: "pve", name: "mcp-smoke-102", status: "stopped" },
              { type: "qemu", vmid: 202, node: "pve", name: "mcp-smoke-qemu-202", status: "stopped" },
              { type: "qemu", vmid: 300, node: "pve", name: "production-vm", status: "running" },
              { type: "storage", id: "local" },
            ],
          },
        },
      },
      {
        method: "DELETE",
        path: "/api2/json/nodes/pve/lxc/102?purge=1&destroy-unreferenced-disks=1&force=1",
        status: 200,
        body: { data: "UPID:pve:0001:destroy-102" },
      },
      {
        method: "DELETE",
        path: "/api2/json/nodes/pve/qemu/202?purge=1&destroy-unreferenced-disks=1",
        status: 200,
        body: { data: "UPID:pve:0002:destroy-202" },
      },
    ]);
    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "1");
    const tool = createProxmoxCleanupSmokeResourcesTool(() => mkClient());
    const r = await tool.execute("test", {
      force: true,
      confirm: true,
      destructive: true,
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.matched).toBe(2);
    expect(payload.destroyed.map((d: { vmid: number }) => d.vmid)).toEqual([102, 202]);
    expect(payload.skipped).toBe(2);
    expect(fake.requests.filter((q) => q.method === "DELETE")).toHaveLength(2);
  });
});
