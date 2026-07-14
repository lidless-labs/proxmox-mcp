import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxResizeDiskTool } from "../../src/tools/proxmox_resize_disk.ts";
import { WriteGateError } from "../../src/gates.ts";
import { ToolInputError } from "../../src/tools/_util.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

function makeTool() {
  return createProxmoxResizeDiskTool(
    () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false }),
  );
}

const clusterVm = {
  method: "GET",
  path: "/api2/json/cluster/resources",
  status: 200,
  body: { data: [{ vmid: 200, node: "pve", type: "qemu" }] },
} as const;

describe("proxmox_resize_disk", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    await expect(makeTool().execute("t", { vmid: 200, disk: "scsi0", size: "+2G" })).rejects.toThrow(WriteGateError);
  });

  it("rejects an invalid size", async () => {
    fake = await startFakeProxmox([clusterVm]);
    await expect(
      makeTool().execute("t", { vmid: 200, disk: "scsi0", size: "huge", confirm: true }),
    ).rejects.toThrow(ToolInputError);
  });

  it("rejects an invalid disk key", async () => {
    fake = await startFakeProxmox([clusterVm]);
    await expect(
      makeTool().execute("t", { vmid: 200, disk: "scsi 0", size: "+2G", confirm: true }),
    ).rejects.toThrow(ToolInputError);
  });

  it("PUTs disk+size to the resize endpoint for the resolved type", async () => {
    fake = await startFakeProxmox([
      clusterVm,
      { method: "PUT", path: "/api2/json/nodes/pve/qemu/200/resize", status: 200, body: { data: "UPID:pve:resize" } },
    ]);
    const r = await makeTool().execute("t", { vmid: 200, disk: "scsi0", size: "+8G", confirm: true });
    const put = fake.requests.find((q) => q.method === "PUT");
    expect(put?.path).toBe("/api2/json/nodes/pve/qemu/200/resize");
    expect(Object.fromEntries(new URLSearchParams(put?.body ?? ""))).toEqual({ disk: "scsi0", size: "+8G" });
    expect(JSON.parse(r.content[0].text).upid).toBe("UPID:pve:resize");
  });
});
