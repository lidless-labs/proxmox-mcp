import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment } from "./_util.ts";

const Schema = Type.Object(
  {
    node: Type.String({ minLength: 1, description: "Node whose physical disks to list." }),
    include_partitions: Type.Optional(
      Type.Boolean({ description: "Include partitions in the listing (default false)." }),
    ),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_list_disks";

interface PhysicalDisk {
  devpath: string;
  model?: string;
  serial?: string;
  size?: number;
  type?: string;
  health?: string;
  used?: string;
  wearout?: number;
}

export function createProxmoxListDisksTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list disks",
    description:
      "List a node's physical disks with model, size, type, SMART health and wearout (GET /nodes/{node}/disks/list). Tier-1 read.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ node: string; include_partitions?: boolean }>(Schema, raw, NAME);
      assertSafePathSegment(args.node, "node");
      const qs = args.include_partitions ? "?include-partitions=1" : "";
      const disks = await getClient().get<PhysicalDisk[]>(`/nodes/${args.node}/disks/list${qs}`);
      return jsonToolResult({ node: args.node, count: disks.length, disks });
    },
  };
}
