import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import {
  createProxmoxListUsersTool,
  createProxmoxListAclTool,
  createProxmoxListTokensTool,
  createProxmoxSetAclTool,
  createProxmoxCreateTokenTool,
  createProxmoxDeleteTokenTool,
  createProxmoxCreatePoolTool,
  createProxmoxUpdatePoolTool,
  createProxmoxDeletePoolTool,
} from "../../src/tools/index.ts";
import { WriteGateError } from "../../src/gates.ts";
import { ToolInputError } from "../../src/tools/_util.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });
const client = () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });

describe("access reads", () => {
  it("lists users", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/access/users", status: 200, body: { data: [{ userid: "root@pam" }] } },
    ]);
    expect(JSON.parse((await createProxmoxListUsersTool(client).execute()).content[0].text).count).toBe(1);
  });

  it("lists acl", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/access/acl", status: 200, body: { data: [{ path: "/", roleid: "Administrator", ugid: "root@pam", type: "user" }] } },
    ]);
    expect(JSON.parse((await createProxmoxListAclTool(client).execute()).content[0].text).count).toBe(1);
  });

  it("lists tokens for a user and rejects a bad userid", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/access/users/" + encodeURIComponent("bob@pve") + "/token", status: 200, body: { data: [{ tokenid: "ci" }] } },
    ]);
    expect(JSON.parse((await createProxmoxListTokensTool(client).execute("t", { userid: "bob@pve" })).content[0].text).count).toBe(1);
    fake.reset();
    await expect(createProxmoxListTokensTool(client).execute("t", { userid: "not-a-user" })).rejects.toThrow(ToolInputError);
  });
});

describe("set_acl", () => {
  it("refuses without confirm", async () => {
    fake = await startFakeProxmox([]);
    await expect(createProxmoxSetAclTool(client).execute("t", { path: "/vms/100", roles: "PVEVMAdmin", userid: "bob@pve" })).rejects.toThrow(WriteGateError);
  });

  it("routes a plain user to `users`", async () => {
    fake = await startFakeProxmox([{ method: "PUT", path: "/api2/json/access/acl", status: 200, body: { data: null } }]);
    await createProxmoxSetAclTool(client).execute("t", { path: "/vms/100", roles: "PVEVMAdmin", userid: "bob@pve", confirm: true });
    const put = fake.requests.find((q) => q.method === "PUT");
    expect(Object.fromEntries(new URLSearchParams(put?.body ?? ""))).toEqual({ path: "/vms/100", roles: "PVEVMAdmin", users: "bob@pve", propagate: "1" });
  });

  it("routes a token target to `tokens` and honors remove", async () => {
    fake = await startFakeProxmox([{ method: "PUT", path: "/api2/json/access/acl", status: 200, body: { data: null } }]);
    await createProxmoxSetAclTool(client).execute("t", { path: "/vms/110", roles: "PVEVMUser", userid: "mcp-smoke@pve!live-smoke", remove: true, confirm: true });
    const put = fake.requests.find((q) => q.method === "PUT");
    expect(Object.fromEntries(new URLSearchParams(put?.body ?? ""))).toEqual({ path: "/vms/110", roles: "PVEVMUser", tokens: "mcp-smoke@pve!live-smoke", propagate: "1", delete: "1" });
  });

  it("rejects an unsafe path", async () => {
    fake = await startFakeProxmox([]);
    await expect(createProxmoxSetAclTool(client).execute("t", { path: "vms/100", roles: "X", userid: "bob@pve", confirm: true })).rejects.toThrow(ToolInputError);
  });
});

describe("tokens", () => {
  it("create_token returns the secret once", async () => {
    fake = await startFakeProxmox([
      { method: "POST", path: "/api2/json/access/users/" + encodeURIComponent("automation@pve") + "/token/ci", status: 200,
        body: { data: { "full-tokenid": "automation@pve!ci", value: "s3cr3t-uuid" } } },
    ]);
    const r = await createProxmoxCreateTokenTool(client).execute("t", { userid: "automation@pve", tokenid: "ci", confirm: true });
    const p = JSON.parse(r.content[0].text);
    expect(p.full_tokenid).toBe("automation@pve!ci");
    expect(p.secret).toBe("s3cr3t-uuid");
    const post = fake.requests.find((q) => q.method === "POST");
    expect(new URLSearchParams(post?.body ?? "").get("privsep")).toBe("1");
  });

  it("delete_token DELETEs", async () => {
    fake = await startFakeProxmox([
      { method: "DELETE", path: "/api2/json/access/users/" + encodeURIComponent("automation@pve") + "/token/ci", status: 200, body: { data: null } },
    ]);
    await createProxmoxDeleteTokenTool(client).execute("t", { userid: "automation@pve", tokenid: "ci", confirm: true });
    expect(fake.requests[0].method).toBe("DELETE");
  });
});

describe("pools", () => {
  it("creates a pool", async () => {
    fake = await startFakeProxmox([{ method: "POST", path: "/api2/json/pools", status: 200, body: { data: null } }]);
    await createProxmoxCreatePoolTool(client).execute("t", { poolid: "team-a", comment: "Team A", confirm: true });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toEqual({ poolid: "team-a", comment: "Team A" });
  });

  it("update_pool adds vms and validates the list", async () => {
    fake = await startFakeProxmox([{ method: "PUT", path: "/api2/json/pools/team-a", status: 200, body: { data: null } }]);
    await createProxmoxUpdatePoolTool(client).execute("t", { poolid: "team-a", vms: "100,101", confirm: true });
    const put = fake.requests.find((q) => q.method === "PUT");
    expect(Object.fromEntries(new URLSearchParams(put?.body ?? ""))).toEqual({ vms: "100,101" });
    fake.reset();
    await expect(createProxmoxUpdatePoolTool(client).execute("t", { poolid: "team-a", vms: "1,x", confirm: true })).rejects.toThrow(ToolInputError);
  });

  it("update_pool removes members with delete flag", async () => {
    fake = await startFakeProxmox([{ method: "PUT", path: "/api2/json/pools/team-a", status: 200, body: { data: null } }]);
    await createProxmoxUpdatePoolTool(client).execute("t", { poolid: "team-a", vms: "100", remove: true, confirm: true });
    const put = fake.requests.find((q) => q.method === "PUT");
    expect(Object.fromEntries(new URLSearchParams(put?.body ?? ""))).toEqual({ vms: "100", delete: "1" });
  });

  it("deletes a pool", async () => {
    fake = await startFakeProxmox([{ method: "DELETE", path: "/api2/json/pools/team-a", status: 200, body: { data: null } }]);
    await createProxmoxDeletePoolTool(client).execute("t", { poolid: "team-a", confirm: true });
    expect(fake.requests[0].method).toBe("DELETE");
  });
});
