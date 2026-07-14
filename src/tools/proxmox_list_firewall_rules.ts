import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { firewallScopeFields, resolveFirewallBase, type FirewallScopeArgs } from "./firewall-target.ts";

const Schema = Type.Object({ ...firewallScopeFields }, { additionalProperties: false });

const NAME = "proxmox_list_firewall_rules";

export function createProxmoxListFirewallRulesTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list firewall rules",
    description:
      "List firewall rules at the cluster, node, or guest scope (GET {base}/firewall/rules). Returns rule position, action, direction, and match fields. Tier-1 read.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<FirewallScopeArgs>(Schema, raw, NAME);
      const client = getClient();
      const { base, label } = await resolveFirewallBase(client, args, NAME);
      const rules = await client.get<unknown[]>(`${base}/rules`);
      return jsonToolResult({ scope: label, count: Array.isArray(rules) ? rules.length : 0, rules });
    },
  };
}
