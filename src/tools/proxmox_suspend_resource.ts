import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
    todisk: Type.Optional(
      Type.Boolean({ description: "QEMU: suspend to disk (hibernate) instead of to RAM." }),
    ),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_suspend_resource";

export function createProxmoxSuspendResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: suspend resource",
    description:
      "Suspend (pause) a running LXC or QEMU guest (POST /nodes/{node}/{type}/{vmid}/status/suspend). QEMU can suspend to disk with todisk:true. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; todisk?: boolean; confirm: boolean }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const body: Record<string, unknown> = {};
      if (args.todisk && type === "qemu") body.todisk = 1;
      const upid = await client.post<string>(`/nodes/${node}/${type}/${args.vmid}/status/suspend`, body);
      return jsonToolResult({ vmid: args.vmid, node, type, upid });
    },
  };
}
