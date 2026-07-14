import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_resume_resource";

export function createProxmoxResumeResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: resume resource",
    description:
      "Resume a suspended LXC or QEMU guest (POST /nodes/{node}/{type}/{vmid}/status/resume). Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; confirm: boolean }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const upid = await client.post<string>(`/nodes/${node}/${type}/${args.vmid}/status/resume`, {});
      return jsonToolResult({ vmid: args.vmid, node, type, upid });
    },
  };
}
