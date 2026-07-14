import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxRestoreBackupTool } from "../../src/tools/proxmox_restore_backup.ts";
import { WriteGateError } from "../../src/gates.ts";
import { ToolInputError } from "../../src/tools/_util.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

function makeTool() {
  return createProxmoxRestoreBackupTool(
    () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false }),
  );
}

const emptyCluster = { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ node: "pve", type: "node" }] } } as const;
const archive = "local:backup/vzdump-lxc-115-2026_01_01-00_00_00.tar.zst";

describe("proxmox_restore_backup", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    await expect(makeTool().execute("t", { vmid: 950, archive })).rejects.toThrow(WriteGateError);
  });

  it("restores an LXC to a NEW vmid using the ostemplate field (PVE quirk)", async () => {
    fake = await startFakeProxmox([
      emptyCluster,
      { method: "POST", path: "/api2/json/nodes/pve/lxc", status: 200, body: { data: "UPID:pve:restore" } },
    ]);
    const r = await makeTool().execute("t", { vmid: 950, archive, confirm: true });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(post?.path).toBe("/api2/json/nodes/pve/lxc");
    const body = Object.fromEntries(new URLSearchParams(post?.body ?? ""));
    // LXC restore carries the archive in `ostemplate`, not `archive`.
    expect(body).toMatchObject({ vmid: "950", ostemplate: archive, restore: "1" });
    expect(body.archive).toBeUndefined();
    const payload = JSON.parse(r.content[0].text);
    expect(payload.type).toBe("lxc");
    expect(payload.overwrite).toBe(false);
  });

  it("restores a QEMU VM using the archive field", async () => {
    const vmArchive = "local:backup/vzdump-qemu-103-2026_01_01-00_00_00.vma.zst";
    fake = await startFakeProxmox([
      emptyCluster,
      { method: "POST", path: "/api2/json/nodes/pve/qemu", status: 200, body: { data: "UPID:pve:restore" } },
    ]);
    await makeTool().execute("t", { vmid: 951, archive: vmArchive, confirm: true });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(post?.path).toBe("/api2/json/nodes/pve/qemu");
    const body = Object.fromEntries(new URLSearchParams(post?.body ?? ""));
    expect(body).toMatchObject({ vmid: "951", archive: vmArchive, restore: "1" });
    expect(body.ostemplate).toBeUndefined();
  });

  it("blocks overwriting an existing vmid without force", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 115, node: "pve", type: "lxc" }] } },
    ]);
    await expect(
      makeTool().execute("t", { vmid: 115, archive, confirm: true }),
    ).rejects.toThrow(/already exists/);
  });

  it("requires the destructive env gate to overwrite an existing vmid", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 115, node: "pve", type: "lxc" }] } },
    ]);
    // force:true but destructive gate not satisfied (no env flag / destructive arg)
    await expect(
      makeTool().execute("t", { vmid: 115, archive, force: true, confirm: true }),
    ).rejects.toThrow(WriteGateError);
  });

  it("errors when type cannot be inferred and none supplied", async () => {
    fake = await startFakeProxmox([emptyCluster]);
    await expect(
      makeTool().execute("t", { vmid: 950, archive: "local:backup/mystery.dat", confirm: true }),
    ).rejects.toThrow(ToolInputError);
  });
});
