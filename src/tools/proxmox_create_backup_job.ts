import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    schedule: Type.String({ minLength: 1, description: "Systemd-calendar schedule, e.g. '02:00' or 'mon..fri 21:00'." }),
    storage: Type.String({ minLength: 1, description: "Target storage for the backups." }),
    all: Type.Optional(Type.Boolean({ description: "Back up all guests. Mutually exclusive with vmid/pool." })),
    vmid: Type.Optional(Type.String({ minLength: 1, description: "Comma-separated VMIDs to back up." })),
    pool: Type.Optional(Type.String({ minLength: 1, description: "Back up all guests in this pool." })),
    mode: Type.Optional(
      Type.Union([Type.Literal("snapshot"), Type.Literal("suspend"), Type.Literal("stop")], {
        description: "Backup mode (default snapshot).",
      }),
    ),
    compress: Type.Optional(
      Type.Union([Type.Literal("zstd"), Type.Literal("gzip"), Type.Literal("lzo"), Type.Literal("0")], {
        description: "Compression (default zstd).",
      }),
    ),
    enabled: Type.Optional(Type.Boolean({ description: "Whether the job is active (default true)." })),
    mailto: Type.Optional(Type.String({ minLength: 1, description: "Email address for notifications." })),
    comment: Type.Optional(Type.String({ description: "Job comment/description." })),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_create_backup_job";

export function createProxmoxCreateBackupJobTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: create backup job",
    description:
      "Create a scheduled backup (vzdump) job (POST /cluster/backup). Specify a schedule + storage and a selection (all, vmid list, or pool). Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        schedule: string;
        storage: string;
        all?: boolean;
        vmid?: string;
        pool?: string;
        mode?: string;
        compress?: string;
        enabled?: boolean;
        mailto?: string;
        comment?: string;
        confirm: boolean;
      }>(Schema, raw, NAME);
      const selectors = [args.all ? "all" : null, args.vmid ? "vmid" : null, args.pool ? "pool" : null].filter(Boolean);
      if (selectors.length === 0) {
        throw new ToolInputError(`${NAME}: provide exactly one selection - all, vmid, or pool.`);
      }
      if (selectors.length > 1) {
        throw new ToolInputError(`${NAME}: selection is exclusive - pass only one of all/vmid/pool.`);
      }
      const body: Record<string, unknown> = {
        schedule: args.schedule,
        storage: args.storage,
        mode: args.mode ?? "snapshot",
        compress: args.compress ?? "zstd",
        enabled: args.enabled === false ? 0 : 1,
      };
      if (args.all) body.all = 1;
      if (args.vmid) body.vmid = args.vmid;
      if (args.pool) body.pool = args.pool;
      if (args.mailto) body.mailto = args.mailto;
      if (typeof args.comment === "string" && args.comment.length > 0) body.comment = args.comment;
      await getClient().post(`/cluster/backup`, body);
      return jsonToolResult({ schedule: args.schedule, storage: args.storage, created: true });
    },
  };
}
