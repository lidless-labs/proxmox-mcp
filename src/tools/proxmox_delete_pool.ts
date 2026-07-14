import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    poolid: Type.String({ minLength: 1, description: "Pool to delete (must be empty)." }),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_delete_pool";

export function createProxmoxDeletePoolTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: delete pool",
    description:
      "Delete a resource pool (DELETE /pools/{poolid}). Proxmox requires the pool to be empty first; guests/storage are not deleted, only the grouping. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ poolid: string; confirm: boolean }>(Schema, raw, NAME);
      assertSafePathSegment(args.poolid, "poolid");
      await getClient().delete(`/pools/${args.poolid}`);
      return jsonToolResult({ poolid: args.poolid, deleted: true });
    },
  };
}
