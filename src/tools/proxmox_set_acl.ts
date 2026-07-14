import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

// ACL path like "/", "/vms/100", "/pool/x", "/storage/local".
const ACL_PATH_RE = /^\/[\w./-]*$/;
const ROLE_RE = /^[A-Za-z][\w.-]*$/;
// user@realm, group, or user@realm!token
const UGID_RE = /^[\w.+-]+(@[\w.-]+)?(![\w.-]+)?$/;

const Schema = Type.Object(
  {
    path: Type.String({ minLength: 1, description: "ACL path, e.g. '/vms/100', '/pool/team', '/storage/local', '/'." }),
    roles: Type.String({ minLength: 1, description: "Role name(s), comma-separated, e.g. 'PVEVMAdmin'." }),
    userid: Type.Optional(Type.String({ minLength: 1, description: "User or token to grant, e.g. 'bob@pve' or 'bob@pve!ci'." })),
    group: Type.Optional(Type.String({ minLength: 1, description: "Group to grant." })),
    propagate: Type.Optional(Type.Boolean({ description: "Propagate to child paths (default true)." })),
    remove: Type.Optional(Type.Boolean({ description: "Remove the ACL instead of adding it." })),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_set_acl";

export function createProxmoxSetAclTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: set ACL",
    description:
      "Grant or remove a role for a user/token or group on a path (PUT /access/acl). Set remove:true to revoke. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        path: string;
        roles: string;
        userid?: string;
        group?: string;
        propagate?: boolean;
        remove?: boolean;
        confirm: boolean;
      }>(Schema, raw, NAME);
      if (!ACL_PATH_RE.test(args.path)) throw new ToolInputError(`${NAME}: invalid path "${args.path}"`);
      for (const r of args.roles.split(",")) {
        if (!ROLE_RE.test(r.trim())) throw new ToolInputError(`${NAME}: invalid role "${r}"`);
      }
      if (!args.userid && !args.group) {
        throw new ToolInputError(`${NAME}: provide userid or group.`);
      }
      const body: Record<string, unknown> = { path: args.path, roles: args.roles };
      if (args.userid) {
        if (!UGID_RE.test(args.userid)) throw new ToolInputError(`${NAME}: invalid userid "${args.userid}"`);
        // A token target (contains '!') uses the `tokens` param; a plain user uses `users`.
        if (args.userid.includes("!")) body.tokens = args.userid;
        else body.users = args.userid;
      }
      if (args.group) body.groups = args.group;
      body.propagate = args.propagate === false ? 0 : 1;
      if (args.remove === true) body.delete = 1;
      await getClient().put(`/access/acl`, body);
      return jsonToolResult({
        path: args.path,
        roles: args.roles,
        userid: args.userid,
        group: args.group,
        removed: args.remove === true,
      });
    },
  };
}
