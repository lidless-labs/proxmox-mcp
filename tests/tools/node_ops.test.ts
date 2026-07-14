import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import {
  createProxmoxListNodeServicesTool,
  createProxmoxListUpdatesTool,
  createProxmoxListDisksTool,
  createProxmoxCancelTaskTool,
  createProxmoxNodePowerTool,
} from "../../src/tools/index.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });
const client = () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });

describe("node ops tools", () => {
  it("list_node_services reads services", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/nodes/pve/services", status: 200, body: { data: [{ name: "pveproxy", state: "running" }] } },
    ]);
    const r = await createProxmoxListNodeServicesTool(client).execute("t", { node: "pve" });
    expect(JSON.parse(r.content[0].text).count).toBe(1);
  });

  it("list_updates reads apt/update", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/nodes/pve/apt/update", status: 200, body: { data: [{ Package: "pve-manager", Version: "9.2.4" }] } },
    ]);
    const r = await createProxmoxListUpdatesTool(client).execute("t", { node: "pve" });
    expect(JSON.parse(r.content[0].text).updates[0].Package).toBe("pve-manager");
  });

  it("list_disks passes include-partitions", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/nodes/pve/disks/list?include-partitions=1", status: 200, body: { data: [{ devpath: "/dev/sda" }] } },
    ]);
    const r = await createProxmoxListDisksTool(client).execute("t", { node: "pve", include_partitions: true });
    expect(JSON.parse(r.content[0].text).disks[0].devpath).toBe("/dev/sda");
  });

  it("cancel_task refuses without confirm", async () => {
    fake = await startFakeProxmox([]);
    await expect(createProxmoxCancelTaskTool(client).execute("t", { upid: "UPID:pve:1:2:3:4:5:x:" })).rejects.toThrow(WriteGateError);
  });

  it("cancel_task rejects a UPID with a path-traversal node segment", async () => {
    fake = await startFakeProxmox([]);
    await expect(
      createProxmoxCancelTaskTool(client).execute("t", { upid: "UPID:../../access:1:2:3:x:100:u:", confirm: true }),
    ).rejects.toThrow(/invalid UPID/);
  });

  it("cancel_task DELETEs task parsed from UPID node", async () => {
    fake = await startFakeProxmox([
      { method: "DELETE", path: "/api2/json/nodes/pve/tasks/" + encodeURIComponent("UPID:pve:1:2:3:vzdump:100:u:"), status: 200, body: { data: null } },
    ]);
    const r = await createProxmoxCancelTaskTool(client).execute("t", { upid: "UPID:pve:1:2:3:vzdump:100:u:", confirm: true });
    expect(JSON.parse(r.content[0].text).node).toBe("pve");
    expect(fake.requests[0].method).toBe("DELETE");
  });

  it("node_power needs the destructive env gate", async () => {
    delete process.env.PROXMOX_ENABLE_DESTRUCTIVE;
    fake = await startFakeProxmox([]);
    await expect(
      createProxmoxNodePowerTool(client).execute("t", { node: "pve", command: "reboot", confirm: true, destructive: true }),
    ).rejects.toThrow(WriteGateError);
  });

  it("node_power posts command when fully gated", async () => {
    process.env.PROXMOX_ENABLE_DESTRUCTIVE = "1";
    fake = await startFakeProxmox([
      { method: "POST", path: "/api2/json/nodes/pve/status", status: 200, body: { data: null } },
    ]);
    await createProxmoxNodePowerTool(client).execute("t", { node: "pve", command: "shutdown", confirm: true, destructive: true });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toEqual({ command: "shutdown" });
    delete process.env.PROXMOX_ENABLE_DESTRUCTIVE;
  });
});
