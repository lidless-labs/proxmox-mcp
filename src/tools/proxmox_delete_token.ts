import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { USERID_RE } from "./proxmox_list_tokens.ts";

const TOKENID_RE = /^[\w.-]+$/;

const Schema = Type.Object(
  {
    userid: Type.String({ minLength: 1, description: "Owning user, e.g. 'automation@pve'." }),
    tokenid: Type.String({ minLength: 1, description: "Token name to revoke (the part after '!')." }),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_delete_token";

export function createProxmoxDeleteTokenTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: delete token",
    description:
      "Revoke an API token (DELETE /access/users/{userid}/token/{tokenid}). Immediately invalidates the token. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ userid: string; tokenid: string; confirm: boolean }>(Schema, raw, NAME);
      if (!USERID_RE.test(args.userid)) throw new ToolInputError(`${NAME}: invalid userid "${args.userid}"`);
      if (!TOKENID_RE.test(args.tokenid)) throw new ToolInputError(`${NAME}: invalid tokenid "${args.tokenid}"`);
      await getClient().delete(
        `/access/users/${encodeURIComponent(args.userid)}/token/${encodeURIComponent(args.tokenid)}`,
      );
      return jsonToolResult({ userid: args.userid, tokenid: args.tokenid, deleted: true });
    },
  };
}
