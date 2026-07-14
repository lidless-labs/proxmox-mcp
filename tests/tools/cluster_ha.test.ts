import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import {
  createProxmoxClusterStatusTool,
  createProxmoxGetClusterOptionsTool,
  createProxmoxClusterLogTool,
  createProxmoxListHaResourcesTool,
  createProxmoxAddHaResourceTool,
  createProxmoxDeleteHaResourceTool,
  createProxmoxCreateReplicationTool,
  createProxmoxDeleteReplicationTool,
} from "../../src/tools/index.ts";
import { WriteGateError } from "../../src/gates.ts";
import { ToolInputError } from "../../src/tools/_util.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });
const client = () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });

describe("cluster reads", () => {
  it("cluster_status wraps the node array", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/status", status: 200, body: { data: [{ id: "node/pve", name: "pve", online: 1 }] } },
    ]);
    expect(JSON.parse((await createProxmoxClusterStatusTool(client).execute()).content[0].text).count).toBe(1);
  });

  it("get_cluster_options returns the options object", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/options", status: 200, body: { data: { keyboard: "en-us", mac_prefix: "BC:24:11" } } },
    ]);
    const p = JSON.parse((await createProxmoxGetClusterOptionsTool(client).execute()).content[0].text);
    expect(p.options.keyboard).toBe("en-us");
  });

  it("cluster_log passes max", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/log?max=10", status: 200, body: { data: [{ msg: "x" }] } },
    ]);
    await createProxmoxClusterLogTool(client).execute("t", { max: 10 });
    expect(fake.requests[0].path).toBe("/api2/json/cluster/log?max=10");
  });

  it("list_ha_resources handles an empty cluster", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/ha/resources", status: 200, body: { data: [] } },
    ]);
    expect(JSON.parse((await createProxmoxListHaResourcesTool(client).execute()).content[0].text).count).toBe(0);
  });
});

describe("HA resource writes", () => {
  it("refuses without confirm", async () => {
    fake = await startFakeProxmox([]);
    await expect(createProxmoxAddHaResourceTool(client).execute("t", { sid: "vm:100" })).rejects.toThrow(WriteGateError);
  });

  it("rejects a malformed sid", async () => {
    fake = await startFakeProxmox([]);
    await expect(createProxmoxAddHaResourceTool(client).execute("t", { sid: "100", confirm: true })).rejects.toThrow(ToolInputError);
  });

  it("adds an HA resource with defaulted state", async () => {
    fake = await startFakeProxmox([
      { method: "POST", path: "/api2/json/cluster/ha/resources", status: 200, body: { data: null } },
    ]);
    await createProxmoxAddHaResourceTool(client).execute("t", { sid: "ct:115", confirm: true });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toEqual({ sid: "ct:115", state: "started" });
  });

  it("deletes an HA resource (sid encoded in path)", async () => {
    fake = await startFakeProxmox([
      { method: "DELETE", path: "/api2/json/cluster/ha/resources/" + encodeURIComponent("vm:100"), status: 200, body: { data: null } },
    ]);
    await createProxmoxDeleteHaResourceTool(client).execute("t", { sid: "vm:100", confirm: true });
    expect(fake.requests[0].method).toBe("DELETE");
  });
});

describe("replication writes", () => {
  it("refuses replicating to the same node", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 100, node: "pve1", type: "qemu" }] } },
    ]);
    await expect(
      createProxmoxCreateReplicationTool(client).execute("t", { vmid: 100, target: "pve1", confirm: true }),
    ).rejects.toThrow(/must differ/);
  });

  it("creates a replication job with id <vmid>-<n>", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 100, node: "pve1", type: "qemu" }] } },
      { method: "POST", path: "/api2/json/cluster/replication", status: 200, body: { data: null } },
    ]);
    const r = await createProxmoxCreateReplicationTool(client).execute("t", { vmid: 100, target: "pve2", confirm: true });
    expect(JSON.parse(r.content[0].text).id).toBe("100-0");
    const post = fake.requests.find((q) => q.method === "POST");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toMatchObject({ id: "100-0", type: "local", target: "pve2", schedule: "*/15" });
  });

  it("delete_replication validates the id format", async () => {
    fake = await startFakeProxmox([]);
    await expect(createProxmoxDeleteReplicationTool(client).execute("t", { id: "nope", confirm: true })).rejects.toThrow(ToolInputError);
  });
});
