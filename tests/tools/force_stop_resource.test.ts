import { describe, it, expect, afterEach, vi } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxForceStopResourceTool } from "../../src/tools/proxmox_force_stop_resource.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
  vi.unstubAllEnvs();
});

function makeTool() {
  return createProxmoxForceStopResourceTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
  );
}

describe("proxmox_force_stop_resource", () => {
  it("refuses without env flag even with confirm+destructive", async () => {
    fake = await startFakeProxmox([]);
    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "");
    const tool = makeTool();
    await expect(
      tool.execute("test", { vmid: 110, confirm: true, destructive: true }),
    ).rejects.toThrow(WriteGateError);
    await expect(
      tool.execute("test", { vmid: 110, confirm: true, destructive: true }),
    ).rejects.toThrow(/PROXMOX_ENABLE_DESTRUCTIVE/);
    expect(fake.requests).toHaveLength(0);
  });

  it("refuses without destructive:true even when env flag set + confirm:true", async () => {
    fake = await startFakeProxmox([]);
    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "1");
    const tool = makeTool();
    await expect(
      tool.execute("test", { vmid: 110, confirm: true }),
    ).rejects.toThrow(WriteGateError);
    expect(fake.requests).toHaveLength(0);
  });

  it("refuses without confirm:true even when env flag set + destructive:true", async () => {
    fake = await startFakeProxmox([]);
    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "1");
    const tool = makeTool();
    await expect(
      tool.execute("test", { vmid: 110, destructive: true }),
    ).rejects.toThrow(WriteGateError);
    expect(fake.requests).toHaveLength(0);
  });

  it("POSTs to /nodes/{node}/{type}/{vmid}/status/stop", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "qemu" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/qemu/110/status/stop",
        status: 200,
        body: { data: "UPID:pve:00055:forcestop" },
      },
    ]);
    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "1");
    const tool = makeTool();
    const r = await tool.execute("test", {
      vmid: 110,
      confirm: true,
      destructive: true,
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(110);
    expect(payload.node).toBe("pve");
    expect(payload.type).toBe("qemu");
    expect(payload.upid).toBe("UPID:pve:00055:forcestop");
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(postReq?.path).toBe("/api2/json/nodes/pve/qemu/110/status/stop");
  });
});
