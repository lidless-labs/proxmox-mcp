import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const VMID_LIST_RE = /^\d+(,\d+)*$/;

const Schema = Type.Object(
  {
    poolid: Type.String({ minLength: 1, description: "Pool to modify." }),
    vms: Type.Optional(Type.String({ minLength: 1, description: "Comma-separated VMIDs to add (or remove with remove:true)." })),
    storage: Type.Optional(Type.String({ minLength: 1, description: "Comma-separated storage IDs to add/remove." })),
    comment: Type.Optional(Type.String({ description: "Update the pool comment." })),
    remove: Type.Optional(Type.Boolean({ description: "Remove the listed members instead of adding them." })),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_update_pool";

export function createProxmoxUpdatePoolTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: update pool",
    description:
      "Add or remove guests/storage in a resource pool, or update its comment (PUT /pools/{poolid}). Set remove:true to detach the listed members. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        poolid: string;
        vms?: string;
        storage?: string;
        comment?: string;
        remove?: boolean;
        confirm: boolean;
      }>(Schema, raw, NAME);
      assertSafePathSegment(args.poolid, "poolid");
      if (args.vms && !VMID_LIST_RE.test(args.vms)) {
        throw new ToolInputError(`${NAME}: vms must be a comma-separated list of numeric VMIDs`);
      }
      if (!args.vms && !args.storage && typeof args.comment !== "string") {
        throw new ToolInputError(`${NAME}: provide vms, storage, or comment to change.`);
      }
      const body: Record<string, unknown> = {};
      if (args.vms) body.vms = args.vms;
      if (args.storage) body.storage = args.storage;
      if (typeof args.comment === "string") body.comment = args.comment;
      if (args.remove === true) body.delete = 1;
      await getClient().put(`/pools/${args.poolid}`, body);
      return jsonToolResult({
        poolid: args.poolid,
        vms: args.vms,
        storage: args.storage,
        removed: args.remove === true,
      });
    },
  };
}
