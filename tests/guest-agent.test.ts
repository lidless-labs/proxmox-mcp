import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "./fake-proxmox.ts";
import { ProxmoxClient } from "../src/proxmox-client.ts";
import { execViaGuestAgent, GuestAgentError } from "../src/guest-agent.ts";
import { createProxmoxExecTool } from "../src/tools/proxmox_exec.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
  delete process.env.PROXMOX_EXEC_BACKEND;
});
const client = () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });

describe("execViaGuestAgent", () => {
  it("posts command as a repeated-key array and polls exec-status", async () => {
    fake = await startFakeProxmox([
      { method: "POST", path: "/api2/json/nodes/pve/qemu/200/agent/exec", status: 200, body: { data: { pid: 42 } } },
      { method: "GET", path: "/api2/json/nodes/pve/qemu/200/agent/exec-status?pid=42", status: 200,
        body: { data: { exited: 1, exitcode: 0, "out-data": "hello\n", "err-data": "" } } },
    ]);
    const r = await execViaGuestAgent(client(), "pve", 200, "echo hello", 5000, undefined, 10);
    expect(r).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 });
    const post = fake.requests.find((q) => q.method === "POST");
    // command must be three repeated keys: /bin/sh, -c, echo hello
    const params = new URLSearchParams(post?.body ?? "");
    expect(params.getAll("command")).toEqual(["/bin/sh", "-c", "echo hello"]);
  });

  it("passes stdin as input-data", async () => {
    fake = await startFakeProxmox([
      { method: "POST", path: "/api2/json/nodes/pve/qemu/200/agent/exec", status: 200, body: { data: { pid: 7 } } },
      { method: "GET", path: "/api2/json/nodes/pve/qemu/200/agent/exec-status?pid=7", status: 200,
        body: { data: { exited: 1, exitcode: 0, "out-data": "" } } },
    ]);
    await execViaGuestAgent(client(), "pve", 200, "cat > /tmp/x", 5000, "payload", 10);
    const post = fake.requests.find((q) => q.method === "POST");
    expect(new URLSearchParams(post?.body ?? "").get("input-data")).toBe("payload");
  });

  it("throws GuestAgentError on timeout", async () => {
    fake = await startFakeProxmox([
      { method: "POST", path: "/api2/json/nodes/pve/qemu/200/agent/exec", status: 200, body: { data: { pid: 9 } } },
      { method: "GET", path: "/api2/json/nodes/pve/qemu/200/agent/exec-status?pid=9", status: 200,
        body: { data: { exited: 0 } } },
    ]);
    await expect(execViaGuestAgent(client(), "pve", 200, "sleep 100", 60, undefined, 20)).rejects.toThrow(GuestAgentError);
  });
});

describe("proxmox_exec routes QEMU through the guest agent when configured", () => {
  it("uses the agent backend for a QEMU VM", async () => {
    process.env.PROXMOX_EXEC_BACKEND = "guest-agent";
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 200, node: "pve", type: "qemu" }] } },
      { method: "POST", path: "/api2/json/nodes/pve/qemu/200/agent/exec", status: 200, body: { data: { pid: 5 } } },
      { method: "GET", path: "/api2/json/nodes/pve/qemu/200/agent/exec-status?pid=5", status: 200,
        body: { data: { exited: 1, exitcode: 0, "out-data": "ok" } } },
    ]);
    const ssh = () => ({ execInLxc: async () => ({ stdout: "", stderr: "", exitCode: 0 }), execViaDirectSsh: async () => { throw new Error("SSH should not be used"); } });
    const tool = createProxmoxExecTool(client, ssh, { vmUser: "root", vmKeyPath: "/k" });
    const r = await tool.execute("t", { vmid: 200, command: "echo ok", confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.stdout).toBe("ok");
    expect(payload.exit_code).toBe(0);
  });
});
