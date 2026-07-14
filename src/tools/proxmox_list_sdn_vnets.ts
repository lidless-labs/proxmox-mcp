import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_list_sdn_vnets";

export function createProxmoxListSdnVnetsTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list SDN vnets",
    description:
      "Software-defined-networking virtual networks. (GET /cluster/sdn/vnets). Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const items = await getClient().get<unknown[]>("/cluster/sdn/vnets");
      const list = Array.isArray(items) ? items : [items];
      return jsonToolResult({ count: list.length, vnets: list });
    },
  };
}
