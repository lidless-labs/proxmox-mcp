import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import {
  createProxmoxSuspendResourceTool,
  createProxmoxResumeResourceTool,
  createProxmoxResetResourceTool,
  createProxmoxConvertToTemplateTool,
} from "../../src/tools/index.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

const client = () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });
const vm = (type: "qemu" | "lxc" = "qemu") => ({
  method: "GET", path: "/api2/json/cluster/resources", status: 200,
  body: { data: [{ vmid: 200, node: "pve", type }] },
}) as const;

describe("lifecycle tools", () => {
  it("suspend refuses without confirm", async () => {
    fake = await startFakeProxmox([]);
    await expect(createProxmoxSuspendResourceTool(client).execute("t", { vmid: 200 })).rejects.toThrow(WriteGateError);
  });

  it("suspend posts todisk for qemu", async () => {
    fake = await startFakeProxmox([
      vm("qemu"),
      { method: "POST", path: "/api2/json/nodes/pve/qemu/200/status/suspend", status: 200, body: { data: "UPID:pve:susp" } },
    ]);
    await createProxmoxSuspendResourceTool(client).execute("t", { vmid: 200, todisk: true, confirm: true });
    const post = fake.requests.find((q) => q.method === "POST");
    expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toEqual({ todisk: "1" });
  });

  it("resume posts to resume endpoint", async () => {
    fake = await startFakeProxmox([
      vm("lxc"),
      { method: "POST", path: "/api2/json/nodes/pve/lxc/200/status/resume", status: 200, body: { data: "UPID:pve:res" } },
    ]);
    const r = await createProxmoxResumeResourceTool(client).execute("t", { vmid: 200, confirm: true });
    expect(JSON.parse(r.content[0].text).upid).toBe("UPID:pve:res");
  });

  it("reset refuses on an LXC", async () => {
    fake = await startFakeProxmox([vm("lxc")]);
    await expect(createProxmoxResetResourceTool(client).execute("t", { vmid: 200, confirm: true })).rejects.toThrow(/QEMU-only/);
  });

  it("reset posts for qemu", async () => {
    fake = await startFakeProxmox([
      vm("qemu"),
      { method: "POST", path: "/api2/json/nodes/pve/qemu/200/status/reset", status: 200, body: { data: "UPID:pve:rst" } },
    ]);
    const r = await createProxmoxResetResourceTool(client).execute("t", { vmid: 200, confirm: true });
    expect(JSON.parse(r.content[0].text).upid).toBe("UPID:pve:rst");
  });

  it("convert_to_template posts to template endpoint for the resolved type", async () => {
    fake = await startFakeProxmox([
      vm("lxc"),
      { method: "POST", path: "/api2/json/nodes/pve/lxc/200/template", status: 200, body: { data: null } },
    ]);
    const r = await createProxmoxConvertToTemplateTool(client).execute("t", { vmid: 200, confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.template).toBe(true);
    expect(payload.type).toBe("lxc");
  });
});
