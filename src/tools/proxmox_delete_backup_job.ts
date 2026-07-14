import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    id: Type.String({ minLength: 1, description: "Backup job ID (from proxmox_list_backup_jobs)." }),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_delete_backup_job";

export function createProxmoxDeleteBackupJobTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: delete backup job",
    description:
      "Delete a scheduled backup job by id (DELETE /cluster/backup/{id}). Removes the schedule only; existing backup archives are untouched. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ id: string; confirm: boolean }>(Schema, raw, NAME);
      assertSafePathSegment(args.id, "id");
      await getClient().delete(`/cluster/backup/${args.id}`);
      return jsonToolResult({ id: args.id, deleted: true });
    },
  };
}
