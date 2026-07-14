import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_list_acl";

interface AclEntry {
  path: string;
  roleid: string;
  type: string;
  ugid: string;
  propagate?: number;
}

export function createProxmoxListAclTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list ACL",
    description:
      "List access-control entries (GET /access/acl): which user/group/token holds which role on which path, and whether it propagates. Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const acl = await getClient().get<AclEntry[]>("/access/acl");
      return jsonToolResult({ count: acl.length, acl });
    },
  };
}
