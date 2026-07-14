import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_list_ha_resources";

export function createProxmoxListHaResourcesTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list HA resources",
    description:
      "HA-managed resources (sid, state, group/comment). (GET /cluster/ha/resources). Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const items = await getClient().get<unknown[]>("/cluster/ha/resources");
      const list = Array.isArray(items) ? items : [items];
      return jsonToolResult({ count: list.length, resources: list });
    },
  };
}
