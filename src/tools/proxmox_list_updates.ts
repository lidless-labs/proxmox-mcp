import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment } from "./_util.ts";

const Schema = Type.Object(
  { node: Type.String({ minLength: 1, description: "Node to check for pending package updates." }) },
  { additionalProperties: false },
);

const NAME = "proxmox_list_updates";

interface AptUpdate {
  Package: string;
  Version?: string;
  OldVersion?: string;
  Title?: string;
  Priority?: string;
}

export function createProxmoxListUpdatesTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list updates",
    description:
      "List pending APT package updates on a node (GET /nodes/{node}/apt/update): package, current and candidate versions. Read-only; does not refresh the index or install anything. Note: Proxmox gates this endpoint behind the Sys.Modify privilege, so an audit-only token gets 403. Tier-1 read.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ node: string }>(Schema, raw, NAME);
      assertSafePathSegment(args.node, "node");
      const updates = await getClient().get<AptUpdate[]>(`/nodes/${args.node}/apt/update`);
      return jsonToolResult({ node: args.node, count: updates.length, updates });
    },
  };
}
