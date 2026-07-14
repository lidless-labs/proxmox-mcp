import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { firewallScopeFields, resolveFirewallBase, type FirewallScopeArgs } from "./firewall-target.ts";

const Schema = Type.Object(
  {
    ...firewallScopeFields,
    pos: Type.Integer({ minimum: 0, description: "Rule position/index to delete (see list_firewall_rules)." }),
    digest: Type.Optional(
      Type.String({ minLength: 1, description: "Ruleset digest for optimistic concurrency." }),
    ),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_delete_firewall_rule";

interface DeleteRuleArgs extends FirewallScopeArgs {
  pos: number;
  digest?: string;
  confirm: boolean;
}

export function createProxmoxDeleteFirewallRuleTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: delete firewall rule",
    description:
      "Delete a firewall rule by position at the cluster, node, or guest scope (DELETE {base}/firewall/rules/{pos}). Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<DeleteRuleArgs>(Schema, raw, NAME);
      const client = getClient();
      const { base, label } = await resolveFirewallBase(client, args, NAME);
      const qs = args.digest ? `?digest=${encodeURIComponent(args.digest)}` : "";
      await client.delete(`${base}/rules/${args.pos}${qs}`);
      return jsonToolResult({ scope: label, pos: args.pos, deleted: true });
    },
  };
}
