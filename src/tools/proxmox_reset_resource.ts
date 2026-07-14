import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "QEMU VM ID." }),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_reset_resource";

export function createProxmoxResetResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: reset resource",
    description:
      "Hard-reset a running QEMU VM (POST /nodes/{node}/qemu/{vmid}/status/reset) - equivalent to the reset button, no graceful shutdown. QEMU only. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; confirm: boolean }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      if (type !== "qemu") {
        throw new Error(`vmid ${args.vmid} is an LXC container; reset is QEMU-only. Use proxmox_reboot_resource.`);
      }
      const upid = await client.post<string>(`/nodes/${node}/qemu/${args.vmid}/status/reset`, {});
      return jsonToolResult({ vmid: args.vmid, node, type, upid });
    },
  };
}
