import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { firewallScopeFields, resolveFirewallBase, type FirewallScopeArgs } from "./firewall-target.ts";

const Schema = Type.Object({ ...firewallScopeFields }, { additionalProperties: false });

const NAME = "proxmox_get_firewall_options";

export function createProxmoxGetFirewallOptionsTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: get firewall options",
    description:
      "Read firewall options at the cluster, node, or guest scope (GET {base}/firewall/options): whether the firewall is enabled, default in/out policy, logging. Tier-1 read.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<FirewallScopeArgs>(Schema, raw, NAME);
      const client = getClient();
      const { base, label } = await resolveFirewallBase(client, args, NAME);
      const options = await client.get<Record<string, unknown>>(`${base}/options`);
      return jsonToolResult({ scope: label, options });
    },
  };
}
