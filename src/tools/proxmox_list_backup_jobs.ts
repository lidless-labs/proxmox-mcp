import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });

const NAME = "proxmox_list_backup_jobs";

interface BackupJob {
  id: string;
  schedule?: string;
  storage?: string;
  enabled?: number;
  mode?: string;
  all?: number;
  vmid?: string;
  pool?: string;
  comment?: string;
}

export function createProxmoxListBackupJobsTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list backup jobs",
    description:
      "List scheduled backup (vzdump) jobs (GET /cluster/backup): id, schedule, target storage, selection, and enabled state. Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const jobs = await getClient().get<BackupJob[]>("/cluster/backup");
      return jsonToolResult({ count: jobs.length, jobs });
    },
  };
}
