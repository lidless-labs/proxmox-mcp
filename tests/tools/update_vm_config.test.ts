import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxUpdateVmConfigTool } from "../../src/tools/proxmox_update_vm_config.ts";
import { WriteGateError } from "../../src/gates.ts";
import { ToolInputError } from "../../src/tools/_util.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

function makeTool() {
  return createProxmoxUpdateVmConfigTool(
    () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false }),
  );
}

const clusterVm = {
  method: "GET",
  path: "/api2/json/cluster/resources",
  status: 200,
  body: { data: [{ vmid: 200, node: "pve", type: "qemu" }] },
} as const;

describe("proxmox_update_vm_config", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    await expect(makeTool().execute("t", { vmid: 200, cores: 4 })).rejects.toThrow(WriteGateError);
  });

  it("rejects a no-op edit with no fields", async () => {
    fake = await startFakeProxmox([clusterVm]);
    await expect(makeTool().execute("t", { vmid: 200, confirm: true })).rejects.toThrow(ToolInputError);
  });

  it("refuses when vmid is an LXC", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 200, node: "pve", type: "lxc" }] } },
    ]);
    await expect(makeTool().execute("t", { vmid: 200, cores: 2, confirm: true })).rejects.toThrow(/LXC container/);
  });

  it("PUTs typed fields, booleans as 1/0, set passthrough, and unset->delete", async () => {
    fake = await startFakeProxmox([
      clusterVm,
      { method: "PUT", path: "/api2/json/nodes/pve/qemu/200/config", status: 200, body: { data: null } },
    ]);
    const r = await makeTool().execute("t", {
      vmid: 200,
      cores: 4,
      memory: 4096,
      onboot: true,
      set: { net0: "virtio,bridge=vmbr0" },
      unset: ["tags"],
      confirm: true,
    });
    const put = fake.requests.find((q) => q.method === "PUT");
    const body = Object.fromEntries(new URLSearchParams(put?.body ?? ""));
    expect(body).toEqual({
      cores: "4",
      memory: "4096",
      onboot: "1",
      net0: "virtio,bridge=vmbr0",
      delete: "tags",
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(200);
    expect(payload.changed).toEqual(expect.arrayContaining(["cores", "memory", "onboot", "net0"]));
    expect(payload.removed).toEqual(["tags"]);
  });

  it("rejects a malformed set key", async () => {
    fake = await startFakeProxmox([clusterVm]);
    await expect(
      makeTool().execute("t", { vmid: 200, set: { "bad key": "x" }, confirm: true }),
    ).rejects.toThrow(ToolInputError);
  });
});
