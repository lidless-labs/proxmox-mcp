import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxUpdateContainerConfigTool } from "../../src/tools/proxmox_update_container_config.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

function makeTool() {
  return createProxmoxUpdateContainerConfigTool(
    () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false }),
  );
}

const clusterCt = {
  method: "GET",
  path: "/api2/json/cluster/resources",
  status: 200,
  body: { data: [{ vmid: 115, node: "pve", type: "lxc" }] },
} as const;

describe("proxmox_update_container_config", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    await expect(makeTool().execute("t", { vmid: 115, cores: 2 })).rejects.toThrow(WriteGateError);
  });

  it("refuses when vmid is a QEMU VM", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 115, node: "pve", type: "qemu" }] } },
    ]);
    await expect(makeTool().execute("t", { vmid: 115, cores: 2, confirm: true })).rejects.toThrow(/QEMU VM/);
  });

  it("PUTs LXC-specific fields (hostname, swap, nameserver)", async () => {
    fake = await startFakeProxmox([
      clusterCt,
      { method: "PUT", path: "/api2/json/nodes/pve/lxc/115/config", status: 200, body: { data: null } },
    ]);
    await makeTool().execute("t", {
      vmid: 115,
      hostname: "web01",
      swap: 1024,
      nameserver: "1.1.1.1",
      memory: 2048,
      confirm: true,
    });
    const put = fake.requests.find((q) => q.method === "PUT");
    const body = Object.fromEntries(new URLSearchParams(put?.body ?? ""));
    expect(body).toEqual({ hostname: "web01", swap: "1024", nameserver: "1.1.1.1", memory: "2048" });
  });
});
