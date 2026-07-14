import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_list_roles";

interface PveRole {
  roleid: string;
  privs?: string;
  special?: number;
}

export function createProxmoxListRolesTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list roles",
    description:
      "List Proxmox roles and their privileges (GET /access/roles). Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const roles = await getClient().get<PveRole[]>("/access/roles");
      return jsonToolResult({ count: roles.length, roles });
    },
  };
}
