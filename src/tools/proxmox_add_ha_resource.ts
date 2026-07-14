import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const SID_RE = /^(vm|ct):\d+$/;

const Schema = Type.Object(
  {
    sid: Type.String({ minLength: 1, description: "HA resource id, 'vm:<vmid>' or 'ct:<vmid>'." }),
    state: Type.Optional(
      Type.Union(
        [Type.Literal("started"), Type.Literal("stopped"), Type.Literal("disabled"), Type.Literal("ignored")],
        { description: "Requested HA state (default 'started')." },
      ),
    ),
    comment: Type.Optional(Type.String({ description: "Comment." })),
    max_restart: Type.Optional(Type.Integer({ minimum: 0, description: "Max restart attempts on the same node." })),
    max_relocate: Type.Optional(Type.Integer({ minimum: 0, description: "Max relocation attempts to other nodes." })),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_add_ha_resource";

export function createProxmoxAddHaResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: add HA resource",
    description:
      "Place a VM or container under HA management (POST /cluster/ha/resources). Only meaningful on a quorate multi-node cluster. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        sid: string;
        state?: string;
        comment?: string;
        max_restart?: number;
        max_relocate?: number;
        confirm: boolean;
      }>(Schema, raw, NAME);
      if (!SID_RE.test(args.sid)) throw new ToolInputError(`${NAME}: sid must be 'vm:<vmid>' or 'ct:<vmid>'`);
      const body: Record<string, unknown> = { sid: args.sid, state: args.state ?? "started" };
      if (typeof args.comment === "string" && args.comment.length > 0) body.comment = args.comment;
      if (typeof args.max_restart === "number") body.max_restart = args.max_restart;
      if (typeof args.max_relocate === "number") body.max_relocate = args.max_relocate;
      await getClient().post(`/cluster/ha/resources`, body);
      return jsonToolResult({ sid: args.sid, state: args.state ?? "started", added: true });
    },
  };
}
