import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, ToolInputError } from "./_util.ts";

// A PVE base userid: name@realm (no token component).
export const USERID_RE = /^[\w.+-]+@[\w.-]+$/;

const Schema = Type.Object(
  { userid: Type.String({ minLength: 1, description: "User to list API tokens for, e.g. 'root@pam'." }) },
  { additionalProperties: false },
);

const NAME = "proxmox_list_tokens";

interface TokenInfo {
  tokenid: string;
  comment?: string;
  expire?: number;
  privsep?: number;
}

export function createProxmoxListTokensTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list tokens",
    description:
      "List API tokens for a user (GET /access/users/{userid}/token). Secrets are never returned by Proxmox after creation. Tier-1 read.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ userid: string }>(Schema, raw, NAME);
      if (!USERID_RE.test(args.userid)) throw new ToolInputError(`${NAME}: invalid userid "${args.userid}"`);
      const tokens = await getClient().get<TokenInfo[]>(`/access/users/${encodeURIComponent(args.userid)}/token`);
      return jsonToolResult({ userid: args.userid, count: tokens.length, tokens });
    },
  };
}
