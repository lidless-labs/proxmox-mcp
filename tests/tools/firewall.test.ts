import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import {
  createProxmoxListFirewallRulesTool,
  createProxmoxGetFirewallOptionsTool,
  createProxmoxAddFirewallRuleTool,
  createProxmoxDeleteFirewallRuleTool,
  createProxmoxSetFirewallEnabledTool,
} from "../../src/tools/index.ts";
import { WriteGateError } from "../../src/gates.ts";
import { ToolInputError } from "../../src/tools/_util.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });
const client = () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });
const guestResolve = {
  method: "GET", path: "/api2/json/cluster/resources", status: 200,
  body: { data: [{ vmid: 100, node: "pve", type: "lxc" }] },
} as const;

describe("firewall tools", () => {
  it("list rules at cluster scope", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/firewall/rules", status: 200, body: { data: [{ pos: 0, action: "ACCEPT", type: "in" }] } },
    ]);
    const r = await createProxmoxListFirewallRulesTool(client).execute("t", { scope: "cluster" });
    expect(JSON.parse(r.content[0].text).count).toBe(1);
  });

  it("node scope requires node arg", async () => {
    fake = await startFakeProxmox([]);
    await expect(createProxmoxListFirewallRulesTool(client).execute("t", { scope: "node" })).rejects.toThrow(ToolInputError);
  });

  it("guest scope resolves node+type into the base path", async () => {
    fake = await startFakeProxmox([
      guestResolve,
      { method: "GET", path: "/api2/json/nodes/pve/lxc/100/firewall/options", status: 200, body: { data: { enable: 1 } } },
    ]);
    const r = await createProxmoxGetFirewallOptionsTool(client).execute("t", { scope: "guest", vmid: 100 });
    expect(JSON.parse(r.content[0].text).scope).toBe("lxc 100");
  });

  it("add rule refuses without confirm", async () => {
    fake = await startFakeProxmox([]);
    await expect(
      createProxmoxAddFirewallRuleTool(client).execute("t", { scope: "cluster", type: "in", action: "ACCEPT" }),
    ).rejects.toThrow(WriteGateError);
  });

  it("add rule posts mapped body at node scope", async () => {
    fake = await startFakeProxmox([
      { method: "POST", path: "/api2/json/nodes/pve/firewall/rules", status: 200, body: { data: null } },
    ]);
    await createProxmoxAddFirewallRuleTool(client).execute("t", {
      scope: "node", node: "pve", type: "in", action: "ACCEPT", proto: "tcp", dport: "22", comment: "ssh", confirm: true,
    });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toEqual({
      type: "in", action: "ACCEPT", proto: "tcp", dport: "22", comment: "ssh", enable: "1",
    });
  });

  it("delete rule DELETEs by pos", async () => {
    fake = await startFakeProxmox([
      { method: "DELETE", path: "/api2/json/cluster/firewall/rules/2", status: 200, body: { data: null } },
    ]);
    await createProxmoxDeleteFirewallRuleTool(client).execute("t", { scope: "cluster", pos: 2, confirm: true });
    expect(fake.requests[0].method).toBe("DELETE");
  });

  it("set enabled PUTs options with 1/0", async () => {
    fake = await startFakeProxmox([
      guestResolve,
      { method: "PUT", path: "/api2/json/nodes/pve/lxc/100/firewall/options", status: 200, body: { data: null } },
    ]);
    await createProxmoxSetFirewallEnabledTool(client).execute("t", { scope: "guest", vmid: 100, enable: false, confirm: true });
    const put = fake.requests.find((q) => q.method === "PUT");
    expect(Object.fromEntries(new URLSearchParams(put?.body ?? ""))).toEqual({ enable: "0" });
  });
});
