import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_cluster_status";

export function createProxmoxClusterStatusTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: cluster status",
    description:
      "Cluster membership + quorum: each node's id, IP, online state, and (on a cluster) the quorate flag. (GET /cluster/status). Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const items = await getClient().get<unknown[]>("/cluster/status");
      const list = Array.isArray(items) ? items : [items];
      return jsonToolResult({ count: list.length, nodes: list });
    },
  };
}
