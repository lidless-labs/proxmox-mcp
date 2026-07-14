import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { resolveTaskWait } from "../../src/tools/task-wait.ts";
import { createProxmoxRunBackupTool } from "../../src/tools/proxmox_run_backup.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });
const client = () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });

const UPID = "UPID:pve:0001:0002:0003:vzdump:100:u@pam:";

describe("resolveTaskWait", () => {
  it("returns undefined when wait is not requested", async () => {
    fake = await startFakeProxmox([]);
    const out = await resolveTaskWait(client(), UPID, {});
    expect(out).toBeUndefined();
  });

  it("returns undefined for a null/synchronous upid", async () => {
    fake = await startFakeProxmox([]);
    const out = await resolveTaskWait(client(), null, { wait: true });
    expect(out).toBeUndefined();
  });

  it("polls to completion and reports ok on exitstatus OK", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: `/api2/json/nodes/pve/tasks/${encodeURIComponent(UPID)}/status`, status: 200,
        body: { data: { status: "stopped", exitstatus: "OK" } } },
    ]);
    const out = await resolveTaskWait(client(), UPID, { wait: true, wait_timeout: 5 }, 10);
    expect(out).toMatchObject({ done: true, exitstatus: "OK", ok: true });
  });

  it("reports ok:false on a non-OK exitstatus", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: `/api2/json/nodes/pve/tasks/${encodeURIComponent(UPID)}/status`, status: 200,
        body: { data: { status: "stopped", exitstatus: "command failed" } } },
    ]);
    const out = await resolveTaskWait(client(), UPID, { wait: true }, 10);
    expect(out).toMatchObject({ done: true, ok: false });
  });
});

describe("run_backup wait integration", () => {
  it("embeds task outcome when wait:true", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 100, node: "pve", type: "lxc" }] } },
      { method: "POST", path: "/api2/json/nodes/pve/vzdump", status: 200, body: { data: UPID } },
      { method: "GET", path: `/api2/json/nodes/pve/tasks/${encodeURIComponent(UPID)}/status`, status: 200,
        body: { data: { status: "stopped", exitstatus: "OK" } } },
    ]);
    const r = await createProxmoxRunBackupTool(client).execute("t", { vmid: 100, storage: "local", wait: true, confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.task).toMatchObject({ done: true, ok: true });
  });

  it("omits task when wait not set", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 100, node: "pve", type: "lxc" }] } },
      { method: "POST", path: "/api2/json/nodes/pve/vzdump", status: 200, body: { data: UPID } },
    ]);
    const r = await createProxmoxRunBackupTool(client).execute("t", { vmid: 100, storage: "local", confirm: true });
    expect(JSON.parse(r.content[0].text).task).toBeUndefined();
  });
});
