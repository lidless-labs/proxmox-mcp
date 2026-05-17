import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxGetTaskLogTool } from "../../src/tools/proxmox_get_task_log.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

const VALID_UPID = "UPID:proxmox-host:00001234:00056789:65A1B2C3:vzdump:114:root@pam:";

describe("proxmox_get_task_log", () => {
  it("parses node from UPID, includes start+limit, returns lines+total", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: `/api2/json/nodes/proxmox-host/tasks/${encodeURIComponent(VALID_UPID)}/log?start=0&limit=50`,
        status: 200,
        body: {
          data: [
            { n: 1, t: "INFO: starting" },
            { n: 2, t: "INFO: backup completed" },
          ],
        },
      },
    ]);
    const tool = createProxmoxGetTaskLogTool(
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
    expect(payload.total).toBe(2);
    expect(payload.lines).toHaveLength(2);
    expect(payload.lines[0].t).toBe("INFO: starting");
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].path).toBe(
      `/api2/json/nodes/proxmox-host/tasks/${encodeURIComponent(VALID_UPID)}/log?start=0&limit=50`,
    );
  });

  it("rejects malformed UPID before any HTTP call", async () => {
    fake = await startFakeProxmox([]);
    const tool = createProxmoxGetTaskLogTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    await expect(tool.execute("test", { upid: "UPID:only:three:segs" })).rejects.toThrow(
      /invalid UPID format/,
    );
    expect(fake.requests).toHaveLength(0);
  });
});
