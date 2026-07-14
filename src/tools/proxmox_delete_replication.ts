import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const REPL_ID_RE = /^\d+-\d+$/;

const Schema = Type.Object(
  {
    id: Type.String({ minLength: 1, description: "Replication job id, '<vmid>-<n>' (from proxmox_list_replication)." }),
    force: Type.Optional(Type.Boolean({ description: "Force removal even if the target is unreachable." })),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_delete_replication";

export function createProxmoxDeleteReplicationTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: delete replication",
    description:
      "Delete a storage replication job (DELETE /cluster/replication/{id}). Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ id: string; force?: boolean; confirm: boolean }>(Schema, raw, NAME);
      if (!REPL_ID_RE.test(args.id)) throw new ToolInputError(`${NAME}: id must be '<vmid>-<n>'`);
      const qs = args.force ? "?force=1" : "";
      await getClient().delete(`/cluster/replication/${args.id}${qs}`);
      return jsonToolResult({ id: args.id, deleted: true });
    },
  };
}
