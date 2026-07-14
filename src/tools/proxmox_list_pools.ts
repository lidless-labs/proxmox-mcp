import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_list_pools";

interface Pool {
  poolid: string;
  comment?: string;
}

export function createProxmoxListPoolsTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list pools",
    description:
      "List all resource pools (GET /pools) with their comments. Use proxmox_list_pool_resources for a pool's members. Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const pools = await getClient().get<Pool[]>("/pools");
      return jsonToolResult({ count: pools.length, pools });
    },
  };
}
