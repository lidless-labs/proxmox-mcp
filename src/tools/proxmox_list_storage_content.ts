import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment } from "./_util.ts";

const Schema = Type.Object(
  {
    node: Type.String({ minLength: 1, description: "Node whose storage to inspect." }),
    storage: Type.String({ minLength: 1, description: "Storage ID, e.g. 'local', 'local-lvm'." }),
    content: Type.Optional(
      Type.Union(
        [
          Type.Literal("backup"),
          Type.Literal("iso"),
          Type.Literal("vztmpl"),
          Type.Literal("images"),
          Type.Literal("rootdir"),
          Type.Literal("snippets"),
        ],
        { description: "Filter by content type (backup, iso, vztmpl, images, rootdir, snippets)." },
      ),
    ),
    vmid: Type.Optional(Type.Integer({ minimum: 1, description: "Filter to a single owning VMID." })),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_list_storage_content";

interface ContentItem {
  volid: string;
  content: string;
  format?: string;
  size?: number;
  vmid?: number;
  ctime?: number;
  notes?: string;
}

export function createProxmoxListStorageContentTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list storage content",
    description:
      "List volumes on a storage (GET /nodes/{node}/storage/{storage}/content): ISOs, container templates, disk images, and backups, with size + owning vmid. Optionally filter by content type or vmid. Tier-1 read.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ node: string; storage: string; content?: string; vmid?: number }>(
        Schema,
        raw,
        NAME,
      );
      assertSafePathSegment(args.node, "node");
      assertSafePathSegment(args.storage, "storage");
      const params = new URLSearchParams();
      if (args.content) params.append("content", args.content);
      if (typeof args.vmid === "number") params.append("vmid", String(args.vmid));
      const qs = params.toString();
      const path = `/nodes/${args.node}/storage/${args.storage}/content${qs ? `?${qs}` : ""}`;
      const items = await getClient().get<ContentItem[]>(path);
      return jsonToolResult({ node: args.node, storage: args.storage, count: items.length, content: items });
    },
  };
}
