import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite, assertEnvFlag } from "../gates.ts";
import { USERID_RE } from "./proxmox_list_tokens.ts";

import { registerSecret } from "../security.ts";
import { resolveTokenConsumer, deliverToken } from "../token-consumer.ts";

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
      "Create an API token for a user (POST /access/users/{userid}/token/{tokenid}). Streams the one-time secret to the operator-configured credential consumer. Requires PROXMOX_ENABLE_IDENTITY_PROVISIONING=1 and PROXMOX_TOKEN_CONSUMER. The secret is never returned. With privsep (default), grant it access separately via proxmox_set_acl. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      assertEnvFlag("PROXMOX_ENABLE_IDENTITY_PROVISIONING", NAME);
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
      const consumer = await resolveTokenConsumer();
      try {
        const res = await getClient().post<CreateTokenResult>(
          `/access/users/${encodeURIComponent(args.userid)}/token/${encodeURIComponent(args.tokenid)}`,
          body,
        );
        if (typeof res?.value !== "string" || !res.value) {
          throw new Error("Token creation returned no credential. Inspect token state before retrying provisioning.");
        }
        const fullTokenId = res["full-tokenid"] ?? `${args.userid}!${args.tokenid}`;
        registerSecret(res.value);
        registerSecret(fullTokenId);
        registerSecret(`PVEAPIToken=${fullTokenId}=${res.value}`);
        await deliverToken(consumer, { userid: args.userid, tokenid: args.tokenid, full_tokenid: fullTokenId, secret: res.value });
        return jsonToolResult({
          userid: args.userid,
          tokenid: args.tokenid,
          delivered: true,
          note: "The credential consumer accepted the token. The secret is not returned.",
        });
      } finally {
        await consumer.close();
      }
    },
  };
}
