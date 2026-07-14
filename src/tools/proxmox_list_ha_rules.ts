import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_list_ha_rules";

export function createProxmoxListHaRulesTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list HA rules",
    description:
      "HA rules (PVE 9+ replacement for HA groups): node affinity and resource placement. (GET /cluster/ha/rules). Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const items = await getClient().get<unknown[]>("/cluster/ha/rules");
      const list = Array.isArray(items) ? items : [items];
      return jsonToolResult({ count: list.length, rules: list });
    },
  };
}
