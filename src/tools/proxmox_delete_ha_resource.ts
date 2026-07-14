import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const SID_RE = /^(vm|ct):\d+$/;

const Schema = Type.Object(
  {
    sid: Type.String({ minLength: 1, description: "HA resource id to remove, 'vm:<vmid>' or 'ct:<vmid>'." }),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_delete_ha_resource";

export function createProxmoxDeleteHaResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: delete HA resource",
    description:
      "Remove a VM or container from HA management (DELETE /cluster/ha/resources/{sid}). The guest keeps running; only HA management stops. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ sid: string; confirm: boolean }>(Schema, raw, NAME);
      if (!SID_RE.test(args.sid)) throw new ToolInputError(`${NAME}: sid must be 'vm:<vmid>' or 'ct:<vmid>'`);
      await getClient().delete(`/cluster/ha/resources/${encodeURIComponent(args.sid)}`);
      return jsonToolResult({ sid: args.sid, deleted: true });
    },
  };
}
