import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment } from "./_util.ts";
import { assertDestructive, assertEnvFlag } from "../gates.ts";

const Schema = Type.Object(
  {
    node: Type.String({ minLength: 1, description: "Node to power-cycle." }),
    command: Type.Union([Type.Literal("reboot"), Type.Literal("shutdown")], {
      description: "'reboot' or 'shutdown' the physical/virtual host.",
    }),
    confirm: Type.Boolean({ description: "Must be true. Tier-3 destructive gate." }),
    destructive: Type.Boolean({ description: "Must be true. Tier-3 destructive gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_node_power";

export function createProxmoxNodePowerTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: node power",
    description:
      "Reboot or shut down an entire Proxmox node (POST /nodes/{node}/status), which takes down every guest on it. Tier-3 destructive; requires confirm:true, destructive:true, and env PROXMOX_ENABLE_DESTRUCTIVE=1.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", NAME);
      assertDestructive(raw, NAME);
      const args = validateToolArgs<{
        node: string;
        command: "reboot" | "shutdown";
        confirm: boolean;
        destructive: boolean;
      }>(Schema, raw, NAME);
      assertSafePathSegment(args.node, "node");
      await getClient().post(`/nodes/${args.node}/status`, { command: args.command });
      return jsonToolResult({ node: args.node, command: args.command, issued: true });
    },
  };
}
