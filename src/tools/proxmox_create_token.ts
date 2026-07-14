import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { USERID_RE } from "./proxmox_list_tokens.ts";

const TOKENID_RE = /^[\w.-]+$/;

const Schema = Type.Object(
  {
    userid: Type.String({ minLength: 1, description: "Owning user, e.g. 'automation@pve'." }),
    tokenid: Type.String({ minLength: 1, description: "New token name (the part after '!')." }),
    comment: Type.Optional(Type.String({ description: "Token comment." })),
    privsep: Type.Optional(
      Type.Boolean({ description: "Privilege separation (default true): the token gets only ACLs granted to it directly." }),
    ),
    expire: Type.Optional(Type.Integer({ minimum: 0, description: "Expiry as a Unix timestamp (0 = never)." })),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_create_token";

interface CreateTokenResult {
  "full-tokenid"?: string;
  value?: string;
  info?: Record<string, unknown>;
}

export function createProxmoxCreateTokenTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: create token",
    description:
      "Create an API token for a user (POST /access/users/{userid}/token/{tokenid}). Returns the secret ONCE - it cannot be retrieved later. With privsep (default), grant it access separately via proxmox_set_acl. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        userid: string;
        tokenid: string;
        comment?: string;
        privsep?: boolean;
        expire?: number;
        confirm: boolean;
      }>(Schema, raw, NAME);
      if (!USERID_RE.test(args.userid)) throw new ToolInputError(`${NAME}: invalid userid "${args.userid}"`);
      if (!TOKENID_RE.test(args.tokenid)) throw new ToolInputError(`${NAME}: invalid tokenid "${args.tokenid}"`);
      const body: Record<string, unknown> = { privsep: args.privsep === false ? 0 : 1 };
      if (typeof args.comment === "string" && args.comment.length > 0) body.comment = args.comment;
      if (typeof args.expire === "number") body.expire = args.expire;
      const res = await getClient().post<CreateTokenResult>(
        `/access/users/${encodeURIComponent(args.userid)}/token/${encodeURIComponent(args.tokenid)}`,
        body,
      );
      return jsonToolResult({
        userid: args.userid,
        tokenid: args.tokenid,
        full_tokenid: res?.["full-tokenid"] ?? `${args.userid}!${args.tokenid}`,
        secret: res?.value ?? null,
        note: "Store the secret now; Proxmox will not show it again.",
      });
    },
  };
}
