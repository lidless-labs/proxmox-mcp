import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const OPT_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

const Schema = Type.Object(
  {
    storage: Type.String({ minLength: 1, description: "New storage ID." }),
    type: Type.Union(
      [
        Type.Literal("dir"),
        Type.Literal("nfs"),
        Type.Literal("cifs"),
        Type.Literal("lvm"),
        Type.Literal("lvmthin"),
        Type.Literal("zfspool"),
        Type.Literal("pbs"),
        Type.Literal("cephfs"),
        Type.Literal("rbd"),
      ],
      { description: "Storage backend type." },
    ),
    content: Type.Optional(
      Type.String({ minLength: 1, description: "Comma-separated content types, e.g. 'images,rootdir' or 'iso,backup,vztmpl'." }),
    ),
    options: Type.Optional(
      Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]), {
        description:
          "Type-specific keys, e.g. {\"path\":\"/mnt/data\"} for dir, {\"server\":\"1.2.3.4\",\"export\":\"/nfs\"} for nfs, {\"vgname\":\"pve\",\"thinpool\":\"data\"} for lvmthin.",
      }),
    ),
    nodes: Type.Optional(Type.String({ minLength: 1, description: "Restrict to these nodes (comma-separated)." })),
    disable: Type.Optional(Type.Boolean({ description: "Create the storage in a disabled state." })),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_create_storage";

export function createProxmoxCreateStorageTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: create storage",
    description:
      "Define a new datacenter storage (POST /storage) of a given type with content types and type-specific keys via `options`. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        storage: string;
        type: string;
        content?: string;
        options?: Record<string, string | number | boolean>;
        nodes?: string;
        disable?: boolean;
        confirm: boolean;
      }>(Schema, raw, NAME);
      assertSafePathSegment(args.storage, "storage");
      const body: Record<string, unknown> = { storage: args.storage, type: args.type };
      if (args.content) body.content = args.content;
      if (args.nodes) body.nodes = args.nodes;
      if (args.disable) body.disable = 1;
      if (args.options) {
        for (const [k, v] of Object.entries(args.options)) {
          if (!OPT_KEY_RE.test(k)) throw new ToolInputError(`${NAME}: invalid option key "${k}"`);
          body[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
        }
      }
      await getClient().post(`/storage`, body);
      return jsonToolResult({ storage: args.storage, type: args.type, created: true });
    },
  };
}
