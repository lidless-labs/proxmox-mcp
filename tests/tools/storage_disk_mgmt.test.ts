import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import {
  createProxmoxMoveDiskTool,
  createProxmoxListStorageConfigTool,
  createProxmoxCreateStorageTool,
  createProxmoxDeleteStorageTool,
  createProxmoxListBackupJobsTool,
  createProxmoxCreateBackupJobTool,
  createProxmoxDeleteBackupJobTool,
} from "../../src/tools/index.ts";
import { WriteGateError } from "../../src/gates.ts";
import { ToolInputError } from "../../src/tools/_util.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; delete process.env.PROXMOX_ENABLE_DESTRUCTIVE; });
const client = () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });
const vm = (type: "qemu" | "lxc") => ({ method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 200, node: "pve", type }] } }) as const;

describe("move_disk", () => {
  it("refuses without confirm", async () => {
    fake = await startFakeProxmox([]);
    await expect(createProxmoxMoveDiskTool(client).execute("t", { vmid: 200, disk: "scsi0", target_storage: "local-lvm" })).rejects.toThrow(WriteGateError);
  });

  it("QEMU uses move_disk with disk+storage", async () => {
    fake = await startFakeProxmox([
      vm("qemu"),
      { method: "POST", path: "/api2/json/nodes/pve/qemu/200/move_disk", status: 200, body: { data: "UPID:pve:move" } },
    ]);
    await createProxmoxMoveDiskTool(client).execute("t", { vmid: 200, disk: "scsi0", target_storage: "nvme", delete_source: true, confirm: true });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(post?.path).toBe("/api2/json/nodes/pve/qemu/200/move_disk");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toEqual({ disk: "scsi0", storage: "nvme", delete: "1" });
  });

  it("LXC uses move_volume with volume+storage", async () => {
    fake = await startFakeProxmox([
      vm("lxc"),
      { method: "POST", path: "/api2/json/nodes/pve/lxc/200/move_volume", status: 200, body: { data: "UPID:pve:move" } },
    ]);
    await createProxmoxMoveDiskTool(client).execute("t", { vmid: 200, disk: "rootfs", target_storage: "nvme", confirm: true });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(post?.path).toBe("/api2/json/nodes/pve/lxc/200/move_volume");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toEqual({ volume: "rootfs", storage: "nvme", delete: "0" });
  });
});

describe("storage config", () => {
  it("lists storage definitions", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/storage", status: 200, body: { data: [{ storage: "local", type: "dir", content: "iso,backup" }] } },
    ]);
    const r = await createProxmoxListStorageConfigTool(client).execute();
    expect(JSON.parse(r.content[0].text).count).toBe(1);
  });

  it("creates a dir storage with options passthrough", async () => {
    fake = await startFakeProxmox([
      { method: "POST", path: "/api2/json/storage", status: 200, body: { data: null } },
    ]);
    await createProxmoxCreateStorageTool(client).execute("t", {
      storage: "scratch", type: "dir", content: "images,rootdir", options: { path: "/mnt/scratch", shared: false }, confirm: true,
    });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toEqual({
      storage: "scratch", type: "dir", content: "images,rootdir", path: "/mnt/scratch", shared: "0",
    });
  });

  it("delete_storage needs the destructive env gate", async () => {
    fake = await startFakeProxmox([]);
    await expect(createProxmoxDeleteStorageTool(client).execute("t", { storage: "scratch", confirm: true, destructive: true })).rejects.toThrow(WriteGateError);
  });

  it("delete_storage DELETEs when fully gated", async () => {
    process.env.PROXMOX_ENABLE_DESTRUCTIVE = "1";
    fake = await startFakeProxmox([
      { method: "DELETE", path: "/api2/json/storage/scratch", status: 200, body: { data: null } },
    ]);
    await createProxmoxDeleteStorageTool(client).execute("t", { storage: "scratch", confirm: true, destructive: true });
    expect(fake.requests[0].method).toBe("DELETE");
  });
});

describe("backup jobs", () => {
  it("lists jobs", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/backup", status: 200, body: { data: [{ id: "backup-1", schedule: "02:00", storage: "local" }] } },
    ]);
    const r = await createProxmoxListBackupJobsTool(client).execute();
    expect(JSON.parse(r.content[0].text).jobs[0].id).toBe("backup-1");
  });

  it("requires exactly one selection", async () => {
    fake = await startFakeProxmox([]);
    await expect(createProxmoxCreateBackupJobTool(client).execute("t", { schedule: "02:00", storage: "local", confirm: true })).rejects.toThrow(ToolInputError);
    await expect(createProxmoxCreateBackupJobTool(client).execute("t", { schedule: "02:00", storage: "local", all: true, pool: "x", confirm: true })).rejects.toThrow(ToolInputError);
  });

  it("creates a job with defaults", async () => {
    fake = await startFakeProxmox([
      { method: "POST", path: "/api2/json/cluster/backup", status: 200, body: { data: null } },
    ]);
    await createProxmoxCreateBackupJobTool(client).execute("t", { schedule: "mon 02:00", storage: "local", vmid: "100,101", confirm: true });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toEqual({
      schedule: "mon 02:00", storage: "local", mode: "snapshot", compress: "zstd", enabled: "1", vmid: "100,101",
    });
  });

  it("deletes a job by id", async () => {
    fake = await startFakeProxmox([
      { method: "DELETE", path: "/api2/json/cluster/backup/backup-1", status: 200, body: { data: null } },
    ]);
    await createProxmoxDeleteBackupJobTool(client).execute("t", { id: "backup-1", confirm: true });
    expect(fake.requests[0].method).toBe("DELETE");
  });
});
