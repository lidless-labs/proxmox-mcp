import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxNextVmidTool } from "../../src/tools/proxmox_next_vmid.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

describe("proxmox_next_vmid", () => {
  it("returns the next available vmid as a number", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/nextid",
        status: 200,
        body: { data: "301" },
      },
    ]);
    const tool = createProxmoxNextVmidTool(
      () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false }),
    );
    const r = await tool.execute("t", {});
    expect(JSON.parse(r.content[0].text)).toEqual({ vmid: 301 });
  });
});
