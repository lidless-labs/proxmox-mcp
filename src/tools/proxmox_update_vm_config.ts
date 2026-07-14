import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { buildConfigBody, configEditFields, type ConfigEditArgs } from "./resource-config.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "QEMU VM ID to reconfigure." }),
    name: Type.Optional(Type.String({ minLength: 1, description: "VM name." })),
    sockets: Type.Optional(Type.Integer({ minimum: 1, description: "CPU sockets." })),
    balloon: Type.Optional(
      Type.Integer({ minimum: 0, description: "Ballooning target in MiB (0 disables)." }),
    ),
    ...configEditFields,
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_update_vm_config";

interface VmConfigArgs extends ConfigEditArgs {
  vmid: number;
  name?: string;
  sockets?: number;
  balloon?: number;
  confirm: boolean;
}

export function createProxmoxUpdateVmConfigTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: update VM config",
    description:
      "Edit an existing QEMU VM's config (PUT /nodes/{node}/qemu/{vmid}/config): cores, memory, sockets, balloon, name, description, onboot, tags, plus arbitrary keys via `set` and key removal via `unset`. Some changes (CPU/mem/disk on a running VM) apply as pending until reboot. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<VmConfigArgs>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      if (type !== "qemu") {
        throw new Error(`vmid ${args.vmid} is an LXC container, not a QEMU VM. Use proxmox_update_container_config.`);
      }
      const body = buildConfigBody(args, { name: args.name, sockets: args.sockets, balloon: args.balloon }, NAME);
      const upid = await client.put<string | null>(`/nodes/${node}/qemu/${args.vmid}/config`, body);
      const changed = Object.keys(body).filter((k) => k !== "digest" && k !== "delete");
      const removed = typeof body.delete === "string" ? body.delete.split(",") : [];
      return jsonToolResult({ vmid: args.vmid, node, type, changed, removed, upid: upid ?? null });
    },
  };
}
