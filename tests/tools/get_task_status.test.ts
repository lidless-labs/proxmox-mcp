import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxGetTaskStatusTool } from "../../src/tools/proxmox_get_task_status.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

const VALID_UPID = "UPID:pve:00001234:00056789:65A1B2C3:qmstart:110:root@pam:";

describe("proxmox_get_task_status", () => {
  it("parses node from UPID and fetches status", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: `/api2/json/nodes/pve/tasks/${encodeURIComponent(VALID_UPID)}/status`,
        status: 200,
        body: {
          data: {
            upid: VALID_UPID,
            node: "pve",
            type: "qmstart",
            id: "110",
            user: "root@pam",
            status: "stopped",
            exitstatus: "OK",
          },
        },
      },
    ]);
    const tool = createProxmoxGetTaskStatusTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    const r = await tool.execute("test", { upid: VALID_UPID });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.status).toBe("stopped");
    expect(payload.exitstatus).toBe("OK");
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].path).toBe(
      `/api2/json/nodes/pve/tasks/${encodeURIComponent(VALID_UPID)}/status`,
    );
  });

  it("rejects malformed UPID before any HTTP call", async () => {
    fake = await startFakeProxmox([]);
    const tool = createProxmoxGetTaskStatusTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    await expect(tool.execute("test", { upid: "not-a-upid" })).rejects.toThrow(/invalid UPID format/);
    expect(fake.requests).toHaveLength(0);
  });
});
