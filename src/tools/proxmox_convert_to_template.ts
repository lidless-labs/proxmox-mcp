import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID to convert into a template." }),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_convert_to_template";

export function createProxmoxConvertToTemplateTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: convert to template",
    description:
      "Convert a stopped VM or container into a template (POST /nodes/{node}/{type}/{vmid}/template). One-way: a template cannot be started, only cloned from. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; confirm: boolean }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const upid = await client.post<string | null>(`/nodes/${node}/${type}/${args.vmid}/template`, {});
      return jsonToolResult({ vmid: args.vmid, node, type, template: true, upid: upid ?? null });
    },
  };
}
