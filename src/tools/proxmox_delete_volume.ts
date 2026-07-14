import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment, ToolInputError } from "./_util.ts";
import { assertDestructive, assertEnvFlag } from "../gates.ts";

// A volid looks like "storage:type/filename" or "storage:vm-100-disk-0".
// Allow the storage/path charset but forbid traversal and control chars.
const VOLID_RE = /^[\w.-]+:[\w./-]+$/;

const Schema = Type.Object(
  {
    node: Type.String({ minLength: 1, description: "Node the storage is on." }),
    storage: Type.String({ minLength: 1, description: "Storage ID holding the volume." }),
    volume: Type.String({
      minLength: 1,
      description: "Full volid to delete, e.g. 'local:backup/vzdump-lxc-100-...tar.zst'.",
    }),
    confirm: Type.Boolean({ description: "Must be true. Tier-3 destructive gate." }),
    destructive: Type.Boolean({ description: "Must be true. Tier-3 destructive gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_delete_volume";

export function createProxmoxDeleteVolumeTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: delete volume",
    description:
      "Permanently delete a storage volume - a backup archive, ISO, template, or disk image (DELETE /nodes/{node}/storage/{storage}/content/{volume}). Tier-3 destructive; requires confirm:true, destructive:true, and env PROXMOX_ENABLE_DESTRUCTIVE=1.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", NAME);
      assertDestructive(raw, NAME);
      const args = validateToolArgs<{
        node: string;
        storage: string;
        volume: string;
        confirm: boolean;
        destructive: boolean;
      }>(Schema, raw, NAME);
      assertSafePathSegment(args.node, "node");
      assertSafePathSegment(args.storage, "storage");
      if (args.volume.includes("..") || !VOLID_RE.test(args.volume)) {
        throw new ToolInputError(`${NAME}: invalid volume id "${args.volume}"`);
      }
      const path = `/nodes/${args.node}/storage/${args.storage}/content/${encodeURIComponent(args.volume)}`;
      const upid = await getClient().delete<string | null>(path);
      return jsonToolResult({ node: args.node, storage: args.storage, volume: args.volume, upid: upid ?? null });
    },
  };
}
