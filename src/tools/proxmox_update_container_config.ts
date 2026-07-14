import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { buildConfigBody, configEditFields, type ConfigEditArgs } from "./resource-config.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "LXC container ID to reconfigure." }),
    hostname: Type.Optional(Type.String({ minLength: 1, description: "Container hostname." })),
    swap: Type.Optional(Type.Integer({ minimum: 0, description: "Swap in MiB." })),
    nameserver: Type.Optional(Type.String({ minLength: 1, description: "DNS server IP(s), space-separated." })),
    ...configEditFields,
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_update_container_config";

interface CtConfigArgs extends ConfigEditArgs {
  vmid: number;
  hostname?: string;
  swap?: number;
  nameserver?: string;
  confirm: boolean;
}

export function createProxmoxUpdateContainerConfigTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: update container config",
    description:
      "Edit an existing LXC container's config (PUT /nodes/{node}/lxc/{vmid}/config): cores, memory, swap, hostname, nameserver, description, onboot, tags, plus arbitrary keys via `set` and key removal via `unset`. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<CtConfigArgs>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      if (type !== "lxc") {
        throw new Error(`vmid ${args.vmid} is a QEMU VM, not an LXC container. Use proxmox_update_vm_config.`);
      }
      const body = buildConfigBody(
        args,
        { hostname: args.hostname, swap: args.swap, nameserver: args.nameserver },
        NAME,
      );
      const upid = await client.put<string | null>(`/nodes/${node}/lxc/${args.vmid}/config`, body);
      const changed = Object.keys(body).filter((k) => k !== "digest" && k !== "delete");
      const removed = typeof body.delete === "string" ? body.delete.split(",") : [];
      return jsonToolResult({ vmid: args.vmid, node, type, changed, removed, upid: upid ?? null });
    },
  };
}
