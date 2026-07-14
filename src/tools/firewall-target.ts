import { Type } from "@sinclair/typebox";
import type { ProxmoxClient } from "../proxmox-client.ts";
import { resolveResource, assertSafePathSegment, ToolInputError } from "./_util.ts";

/** Shared scope-selector fields for every firewall tool. */
export const firewallScopeFields = {
  scope: Type.Union(
    [Type.Literal("cluster"), Type.Literal("node"), Type.Literal("guest")],
    { description: "Firewall scope: 'cluster', 'node' (needs node), or 'guest' (needs vmid)." },
  ),
  node: Type.Optional(Type.String({ minLength: 1, description: "Node name (required when scope='node')." })),
  vmid: Type.Optional(Type.Integer({ minimum: 1, description: "Guest VMID (required when scope='guest')." })),
} as const;

export interface FirewallScopeArgs {
  scope: "cluster" | "node" | "guest";
  node?: string;
  vmid?: number;
}

export interface FirewallTarget {
  base: string;
  label: string;
}

/** Resolve a firewall scope selector to its API base path. */
export async function resolveFirewallBase(
  client: ProxmoxClient,
  args: FirewallScopeArgs,
  toolName: string,
): Promise<FirewallTarget> {
  if (args.scope === "cluster") {
    return { base: "/cluster/firewall", label: "cluster" };
  }
  if (args.scope === "node") {
    if (!args.node) throw new ToolInputError(`${toolName}: node is required when scope='node'`);
    assertSafePathSegment(args.node, "node");
    return { base: `/nodes/${args.node}/firewall`, label: `node ${args.node}` };
  }
  if (typeof args.vmid !== "number") {
    throw new ToolInputError(`${toolName}: vmid is required when scope='guest'`);
  }
  const { node, type } = await resolveResource(client, args.vmid);
  return { base: `/nodes/${node}/${type}/${args.vmid}/firewall`, label: `${type} ${args.vmid}` };
}
