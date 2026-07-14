import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_list_metric_servers";

export function createProxmoxListMetricServersTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list metric servers",
    description:
      "External metrics servers (InfluxDB/Graphite) configured for the cluster. (GET /cluster/metrics/server). Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const items = await getClient().get<unknown[]>("/cluster/metrics/server");
      const list = Array.isArray(items) ? items : [items];
      return jsonToolResult({ count: list.length, servers: list });
    },
  };
}
