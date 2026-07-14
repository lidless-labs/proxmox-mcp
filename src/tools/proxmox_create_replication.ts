import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs, assertSafePathSegment } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Guest to replicate." }),
    target: Type.String({ minLength: 1, description: "Target node to replicate to (must differ from the source node)." }),
    job_number: Type.Optional(Type.Integer({ minimum: 0, description: "Job number, forming the id '<vmid>-<n>' (default 0)." })),
    schedule: Type.Optional(Type.String({ minLength: 1, description: "Replication schedule, e.g. '*/15' or '02:00' (default '*/15')." })),
    rate: Type.Optional(Type.Number({ minimum: 0, description: "Rate limit in MB/s (0 = unlimited)." })),
    comment: Type.Optional(Type.String({ description: "Comment." })),
    disable: Type.Optional(Type.Boolean({ description: "Create the job disabled." })),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_create_replication";

export function createProxmoxCreateReplicationTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: create replication",
    description:
      "Create a storage replication job for a guest to another node (POST /cluster/replication). Requires a multi-node cluster with a different target node. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        vmid: number;
        target: string;
        job_number?: number;
        schedule?: string;
        rate?: number;
        comment?: string;
        disable?: boolean;
        confirm: boolean;
      }>(Schema, raw, NAME);
      assertSafePathSegment(args.target, "target");
      const client = getClient();
      const { node } = await resolveResource(client, args.vmid);
      if (args.target === node) {
        throw new Error(`replication target ${args.target} must differ from the guest's node ${node}.`);
      }
      const id = `${args.vmid}-${args.job_number ?? 0}`;
      const body: Record<string, unknown> = {
        id,
        type: "local",
        target: args.target,
        schedule: args.schedule ?? "*/15",
      };
      if (typeof args.rate === "number") body.rate = args.rate;
      if (typeof args.comment === "string" && args.comment.length > 0) body.comment = args.comment;
      if (args.disable) body.disable = 1;
      await client.post(`/cluster/replication`, body);
      return jsonToolResult({ id, vmid: args.vmid, node, target: args.target, created: true });
    },
  };
}
