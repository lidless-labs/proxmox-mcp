import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_list_users";

interface PveUser {
  userid: string;
  enable?: number;
  expire?: number;
  comment?: string;
  realm?: string;
  "realm-type"?: string;
}

export function createProxmoxListUsersTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list users",
    description:
      "List Proxmox access users (GET /access/users): userid, realm, enabled/expire state, comment. Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const users = await getClient().get<PveUser[]>("/access/users");
      return jsonToolResult({ count: users.length, users });
    },
  };
}
