import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });

const NAME = "proxmox_list_storage_config";

interface StorageDef {
  storage: string;
  type: string;
  content?: string;
  nodes?: string;
  shared?: number;
  disable?: number;
  path?: string;
  server?: string;
}

export function createProxmoxListStorageConfigTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list storage config",
    description:
      "List datacenter storage definitions (GET /storage): id, type, allowed content, node restrictions, shared/disabled flags. This is the cluster storage configuration, distinct from per-node status. Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const defs = await getClient().get<StorageDef[]>("/storage");
      return jsonToolResult({ count: defs.length, storage: defs });
    },
  };
}
