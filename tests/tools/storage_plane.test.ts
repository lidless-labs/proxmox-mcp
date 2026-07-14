import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import {
  createProxmoxListStorageContentTool,
  createProxmoxDownloadUrlTool,
  createProxmoxDeleteVolumeTool,
} from "../../src/tools/index.ts";
import { WriteGateError } from "../../src/gates.ts";
import { ToolInputError } from "../../src/tools/_util.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });
const client = () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });

describe("storage plane tools", () => {
  it("list_storage_content reads and filters by content type", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/nodes/pve/storage/local/content?content=backup", status: 200,
        body: { data: [{ volid: "local:backup/vzdump-lxc-100.tar.zst", content: "backup", size: 123 }] } },
    ]);
    const r = await createProxmoxListStorageContentTool(client).execute("t", { node: "pve", storage: "local", content: "backup" });
    expect(JSON.parse(r.content[0].text).count).toBe(1);
  });

  it("list_storage_content rejects an unsafe storage segment", async () => {
    fake = await startFakeProxmox([]);
    await expect(
      createProxmoxListStorageContentTool(client).execute("t", { node: "pve", storage: "a/b" }),
    ).rejects.toThrow(ToolInputError);
  });

  it("download_url refuses without confirm", async () => {
    fake = await startFakeProxmox([]);
    await expect(
      createProxmoxDownloadUrlTool(client).execute("t", { node: "pve", storage: "local", content: "iso", url: "https://x/y.iso", filename: "y.iso" }),
    ).rejects.toThrow(WriteGateError);
  });

  it("download_url requires checksum_algorithm when checksum set", async () => {
    fake = await startFakeProxmox([]);
    await expect(
      createProxmoxDownloadUrlTool(client).execute("t", { node: "pve", storage: "local", content: "iso", url: "https://x/y.iso", filename: "y.iso", checksum: "abc", confirm: true }),
    ).rejects.toThrow(ToolInputError);
  });

  it("download_url posts mapped body", async () => {
    fake = await startFakeProxmox([
      { method: "POST", path: "/api2/json/nodes/pve/storage/local/download-url", status: 200, body: { data: "UPID:pve:dl" } },
    ]);
    await createProxmoxDownloadUrlTool(client).execute("t", {
      node: "pve", storage: "local", content: "vztmpl", url: "https://x/y.tar.zst", filename: "y.tar.zst",
      checksum: "deadbeef", checksum_algorithm: "sha256", verify_certificates: false, confirm: true,
    });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toEqual({
      content: "vztmpl", url: "https://x/y.tar.zst", filename: "y.tar.zst",
      checksum: "deadbeef", "checksum-algorithm": "sha256", "verify-certificates": "0",
    });
  });

  it("delete_volume needs the destructive env gate", async () => {
    fake = await startFakeProxmox([]);
    delete process.env.PROXMOX_ENABLE_DESTRUCTIVE;
    await expect(
      createProxmoxDeleteVolumeTool(client).execute("t", { node: "pve", storage: "local", volume: "local:backup/x.tar.zst", confirm: true, destructive: true }),
    ).rejects.toThrow(WriteGateError);
  });

  it("delete_volume rejects a traversal volid", async () => {
    fake = await startFakeProxmox([]);
    process.env.PROXMOX_ENABLE_DESTRUCTIVE = "1";
    await expect(
      createProxmoxDeleteVolumeTool(client).execute("t", { node: "pve", storage: "local", volume: "local:../../etc/passwd", confirm: true, destructive: true }),
    ).rejects.toThrow(ToolInputError);
    delete process.env.PROXMOX_ENABLE_DESTRUCTIVE;
  });

  it("delete_volume DELETEs the encoded volid when fully gated", async () => {
    process.env.PROXMOX_ENABLE_DESTRUCTIVE = "1";
    fake = await startFakeProxmox([
      { method: "DELETE", path: "/api2/json/nodes/pve/storage/local/content/local%3Abackup%2Fx.tar.zst", status: 200, body: { data: null } },
    ]);
    const r = await createProxmoxDeleteVolumeTool(client).execute("t", { node: "pve", storage: "local", volume: "local:backup/x.tar.zst", confirm: true, destructive: true });
    expect(JSON.parse(r.content[0].text).volume).toBe("local:backup/x.tar.zst");
    expect(fake.requests[0].method).toBe("DELETE");
    delete process.env.PROXMOX_ENABLE_DESTRUCTIVE;
  });
});
