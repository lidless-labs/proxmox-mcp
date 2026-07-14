import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment } from "./_util.ts";
import { assertDestructive, assertEnvFlag } from "../gates.ts";

const Schema = Type.Object(
  {
    storage: Type.String({ minLength: 1, description: "Storage ID to remove from the datacenter config." }),
    confirm: Type.Boolean({ description: "Must be true. Tier-3 destructive gate." }),
    destructive: Type.Boolean({ description: "Must be true. Tier-3 destructive gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_delete_storage";

export function createProxmoxDeleteStorageTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: delete storage",
    description:
      "Remove a storage definition from the datacenter config (DELETE /storage/{id}). Does not erase the underlying data, but detaches it from Proxmox. Tier-3 destructive; requires confirm:true, destructive:true, and env PROXMOX_ENABLE_DESTRUCTIVE=1.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", NAME);
      assertDestructive(raw, NAME);
      const args = validateToolArgs<{ storage: string; confirm: boolean; destructive: boolean }>(Schema, raw, NAME);
      assertSafePathSegment(args.storage, "storage");
      await getClient().delete(`/storage/${args.storage}`);
      return jsonToolResult({ storage: args.storage, deleted: true });
    },
  };
}
