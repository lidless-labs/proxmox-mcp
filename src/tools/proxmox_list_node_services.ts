import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment } from "./_util.ts";

const Schema = Type.Object(
  { node: Type.String({ minLength: 1, description: "Node to inspect." }) },
  { additionalProperties: false },
);

const NAME = "proxmox_list_node_services";

interface NodeService {
  name: string;
  desc?: string;
  state?: string;
  "active-state"?: string;
  "unit-state"?: string;
}

export function createProxmoxListNodeServicesTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list node services",
    description:
      "List the Proxmox host's systemd services and their state (GET /nodes/{node}/services): pveproxy, pvedaemon, pve-cluster, corosync, etc. Tier-1 read.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ node: string }>(Schema, raw, NAME);
      assertSafePathSegment(args.node, "node");
      const services = await getClient().get<NodeService[]>(`/nodes/${args.node}/services`);
      return jsonToolResult({ node: args.node, count: services.length, services });
    },
  };
}
