import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { firewallScopeFields, resolveFirewallBase, type FirewallScopeArgs } from "./firewall-target.ts";

const Schema = Type.Object(
  {
    ...firewallScopeFields,
    enable: Type.Boolean({ description: "Turn the firewall on (true) or off (false) for this scope." }),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_set_firewall_enabled";

interface SetEnabledArgs extends FirewallScopeArgs {
  enable: boolean;
  confirm: boolean;
}

export function createProxmoxSetFirewallEnabledTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: set firewall enabled",
    description:
      "Enable or disable the firewall at the cluster, node, or guest scope (PUT {base}/firewall/options with enable). Note: the cluster-level switch gates all others. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<SetEnabledArgs>(Schema, raw, NAME);
      const client = getClient();
      const { base, label } = await resolveFirewallBase(client, args, NAME);
      await client.put(`${base}/options`, { enable: args.enable ? 1 : 0 });
      return jsonToolResult({ scope: label, enabled: args.enable });
    },
  };
}
