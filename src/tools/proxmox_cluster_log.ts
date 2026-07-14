import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";

const Schema = Type.Object(
  {
    max: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 1000, description: "Max number of recent log entries (default 50)." }),
    ),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_cluster_log";

export function createProxmoxClusterLogTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: cluster log",
    description:
      "Read the recent cluster-wide log (GET /cluster/log): task start/end, auth, and daemon messages across all nodes. Tier-1 read.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ max?: number }>(Schema, raw, NAME);
      const max = args.max ?? 50;
      const entries = await getClient().get<unknown[]>(`/cluster/log?max=${max}`);
      return jsonToolResult({ count: Array.isArray(entries) ? entries.length : 0, entries });
    },
  };
}
