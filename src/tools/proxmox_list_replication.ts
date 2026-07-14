import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_list_replication";

export function createProxmoxListReplicationTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list replication",
    description:
      "Storage replication jobs (id, source guest, target node, schedule). (GET /cluster/replication). Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const items = await getClient().get<unknown[]>("/cluster/replication");
      const list = Array.isArray(items) ? items : [items];
      return jsonToolResult({ count: list.length, jobs: list });
    },
  };
}
