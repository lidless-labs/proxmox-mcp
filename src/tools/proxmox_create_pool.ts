import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    poolid: Type.String({ minLength: 1, description: "New pool ID." }),
    comment: Type.Optional(Type.String({ description: "Pool comment/description." })),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_create_pool";

export function createProxmoxCreatePoolTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: create pool",
    description:
      "Create a resource pool (POST /pools). Add guests/storage to it with proxmox_update_pool. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ poolid: string; comment?: string; confirm: boolean }>(Schema, raw, NAME);
      assertSafePathSegment(args.poolid, "poolid");
      const body: Record<string, unknown> = { poolid: args.poolid };
      if (typeof args.comment === "string" && args.comment.length > 0) body.comment = args.comment;
      await getClient().post(`/pools`, body);
      return jsonToolResult({ poolid: args.poolid, created: true });
    },
  };
}
