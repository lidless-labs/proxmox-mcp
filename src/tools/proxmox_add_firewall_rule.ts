import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { firewallScopeFields, resolveFirewallBase, type FirewallScopeArgs } from "./firewall-target.ts";

const Schema = Type.Object(
  {
    ...firewallScopeFields,
    type: Type.Union([Type.Literal("in"), Type.Literal("out"), Type.Literal("group")], {
      description: "Rule direction: 'in', 'out', or 'group' (attach a security group).",
    }),
    action: Type.String({
      minLength: 1,
      description: "ACCEPT, DROP, REJECT, or a security-group name when type='group'.",
    }),
    source: Type.Optional(Type.String({ minLength: 1, description: "Source CIDR/IP/alias." })),
    dest: Type.Optional(Type.String({ minLength: 1, description: "Destination CIDR/IP/alias." })),
    proto: Type.Optional(Type.String({ minLength: 1, description: "Protocol, e.g. tcp, udp, icmp." })),
    dport: Type.Optional(Type.String({ minLength: 1, description: "Destination port(s), e.g. '22' or '8000:8100'." })),
    sport: Type.Optional(Type.String({ minLength: 1, description: "Source port(s)." })),
    macro: Type.Optional(Type.String({ minLength: 1, description: "Predefined macro, e.g. 'SSH', 'HTTP'." })),
    comment: Type.Optional(Type.String({ description: "Human-readable comment." })),
    enable: Type.Optional(Type.Boolean({ description: "Whether the rule is active (default true)." })),
    pos: Type.Optional(Type.Integer({ minimum: 0, description: "Insert position (default: prepend at 0)." })),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_add_firewall_rule";

interface AddRuleArgs extends FirewallScopeArgs {
  type: "in" | "out" | "group";
  action: string;
  source?: string;
  dest?: string;
  proto?: string;
  dport?: string;
  sport?: string;
  macro?: string;
  comment?: string;
  enable?: boolean;
  pos?: number;
  confirm: boolean;
}

export function createProxmoxAddFirewallRuleTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: add firewall rule",
    description:
      "Add a firewall rule at the cluster, node, or guest scope (POST {base}/firewall/rules). Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<AddRuleArgs>(Schema, raw, NAME);
      const client = getClient();
      const { base, label } = await resolveFirewallBase(client, args, NAME);
      const body: Record<string, unknown> = { type: args.type, action: args.action };
      for (const k of ["source", "dest", "proto", "dport", "sport", "macro", "comment"] as const) {
        const v = args[k];
        if (typeof v === "string" && v.length > 0) body[k] = v;
      }
      body.enable = args.enable === false ? 0 : 1;
      if (typeof args.pos === "number") body.pos = args.pos;
      await client.post(`${base}/rules`, body);
      return jsonToolResult({ scope: label, type: args.type, action: args.action, added: true });
    },
  };
}
