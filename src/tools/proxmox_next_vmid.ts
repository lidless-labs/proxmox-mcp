import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_next_vmid";

export function createProxmoxNextVmidTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: next vmid",
    description: "Return the next available Proxmox VMID via GET /cluster/nextid.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown> = {}) => {
      validateToolArgs(Schema, raw, NAME);
      const nextid = await getClient().get<string | number>("/cluster/nextid");
      return jsonToolResult({ vmid: Number(nextid) });
    },
  };
}
