import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxMigrateResourceTool } from "../../src/tools/proxmox_migrate_resource.ts";
import { WriteGateError } from "../../src/gates.ts";
import { ToolInputError } from "../../src/tools/_util.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

function makeTool() {
  return createProxmoxMigrateResourceTool(
    () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false }),
  );
}

const clusterVm = { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 200, node: "pve1", type: "qemu" }] } } as const;
const clusterCt = { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 115, node: "pve1", type: "lxc" }] } } as const;

describe("proxmox_migrate_resource", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    await expect(makeTool().execute("t", { vmid: 200, target: "pve2" })).rejects.toThrow(WriteGateError);
  });

  it("rejects an unsafe target node name", async () => {
    fake = await startFakeProxmox([]);
    await expect(
      makeTool().execute("t", { vmid: 200, target: "pve2/../x", confirm: true }),
    ).rejects.toThrow(ToolInputError);
  });

  it("refuses migrating to the same node", async () => {
    fake = await startFakeProxmox([clusterVm]);
    await expect(
      makeTool().execute("t", { vmid: 200, target: "pve1", confirm: true }),
    ).rejects.toThrow(/already on node/);
  });

  it("QEMU: maps online + with_local_disks to PVE flags", async () => {
    fake = await startFakeProxmox([
      clusterVm,
      { method: "POST", path: "/api2/json/nodes/pve1/qemu/200/migrate", status: 200, body: { data: "UPID:pve1:migrate" } },
    ]);
    await makeTool().execute("t", { vmid: 200, target: "pve2", online: true, with_local_disks: true, confirm: true });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(post?.path).toBe("/api2/json/nodes/pve1/qemu/200/migrate");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toEqual({
      target: "pve2",
      online: "1",
      "with-local-disks": "1",
    });
  });

  it("LXC: maps restart mode", async () => {
    fake = await startFakeProxmox([
      clusterCt,
      { method: "POST", path: "/api2/json/nodes/pve1/lxc/115/migrate", status: 200, body: { data: "UPID:pve1:migrate" } },
    ]);
    await makeTool().execute("t", { vmid: 115, target: "pve2", restart: true, confirm: true });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toEqual({ target: "pve2", restart: "1" });
  });
});
