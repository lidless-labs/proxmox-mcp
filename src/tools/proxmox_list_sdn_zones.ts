import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_list_sdn_zones";

export function createProxmoxListSdnZonesTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list SDN zones",
    description:
      "Software-defined-networking zones. (GET /cluster/sdn/zones). Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const items = await getClient().get<unknown[]>("/cluster/sdn/zones");
      const list = Array.isArray(items) ? items : [items];
      return jsonToolResult({ count: list.length, zones: list });
    },
  };
}
