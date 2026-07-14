import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_ha_status";

export function createProxmoxHaStatusTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: HA status",
    description:
      "Current HA manager status: quorum, fencing/CRM state, and per-resource HA state. (GET /cluster/ha/status/current). Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const items = await getClient().get<unknown[]>("/cluster/ha/status/current");
      const list = Array.isArray(items) ? items : [items];
      return jsonToolResult({ count: list.length, entries: list });
    },
  };
}
