import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, ToolInputError, assertSafePathSegment } from "./_util.ts";
import { assertConfirmedWrite, assertDestructive, assertEnvFlag } from "../gates.ts";
import { taskWaitFields, resolveTaskWait, type TaskWaitArgs } from "./task-wait.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Target VMID to restore into." }),
    archive: Type.String({
      minLength: 1,
      description:
        "Backup archive volid or path, e.g. 'local:backup/vzdump-lxc-115-2026_01_01-00_00_00.tar.zst' or a PBS volid.",
    }),
    type: Type.Optional(
      Type.Union([Type.Literal("lxc"), Type.Literal("qemu")], {
        description: "Guest type. Inferred from the archive name when omitted.",
      }),
    ),
    node: Type.Optional(
      Type.String({ minLength: 1, description: "Node to restore on (defaults to first node for a new vmid)." }),
    ),
    storage: Type.Optional(
      Type.String({ minLength: 1, description: "Target storage for restored disks (defaults to the archive's)." }),
    ),
    pool: Type.Optional(Type.String({ minLength: 1, description: "Resource pool to place the guest into." })),
    unique: Type.Optional(
      Type.Boolean({ description: "QEMU: regenerate MAC addresses / UUID on restore." }),
    ),
    force: Type.Optional(
      Type.Boolean({
        description: "Overwrite an EXISTING vmid (wipes its disks). Requires the destructive gate.",
      }),
    ),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
    destructive: Type.Optional(
      Type.Boolean({ description: "Required only when overwriting an existing vmid (force)." }),
    ),
    ...taskWaitFields,
  },
  { additionalProperties: false },
);

const NAME = "proxmox_restore_backup";

interface NodeResource {
  vmid?: number;
  node: string;
  type: string;
}

function inferType(archive: string): "lxc" | "qemu" | null {
  const a = archive.toLowerCase();
  if (a.includes("qemu") || a.includes("/vm/")) return "qemu";
  if (a.includes("lxc") || a.includes("/ct/")) return "lxc";
  return null;
}

export function createProxmoxRestoreBackupTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: restore backup",
    description:
      "Restore a vzdump/PBS backup into a VMID (POST /nodes/{node}/{type}/{vmid} with restore=1). Restoring to a new VMID is Tier-2 (confirm:true). Overwriting an EXISTING VMID wipes its disks and additionally requires force:true, destructive:true, and env PROXMOX_ENABLE_DESTRUCTIVE=1.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        vmid: number;
        archive: string;
        type?: "lxc" | "qemu";
        node?: string;
        storage?: string;
        pool?: string;
        unique?: boolean;
        force?: boolean;
        confirm: boolean;
        destructive?: boolean;
      } & TaskWaitArgs>(Schema, raw, NAME);

      if (/[\r\n]/.test(args.archive)) {
        throw new ToolInputError(`${NAME}: archive must not contain newlines`);
      }
      const type = args.type ?? inferType(args.archive);
      if (!type) {
        throw new ToolInputError(
          `${NAME}: could not infer guest type from archive "${args.archive}". Pass type:"lxc" or "qemu".`,
        );
      }

      const client = getClient();
      const resources = await client.get<NodeResource[]>("/cluster/resources");
      const existing = resources.find(
        (r) => r.vmid === args.vmid && (r.type === "lxc" || r.type === "qemu"),
      );

      let node: string;
      if (existing) {
        // Overwriting a live guest is destructive - gate it fully.
        if (args.force !== true) {
          throw new ToolInputError(
            `${NAME}: vmid ${args.vmid} already exists on ${existing.node}. To overwrite it, pass force:true (also requires destructive:true + PROXMOX_ENABLE_DESTRUCTIVE=1).`,
          );
        }
        assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", NAME);
        assertDestructive(raw, NAME);
        if (existing.type !== type) {
          throw new Error(
            `vmid ${args.vmid} exists as ${existing.type} but archive is ${type}. Refusing cross-type overwrite.`,
          );
        }
        node = existing.node;
      } else {
        if (args.node) {
          assertSafePathSegment(args.node, "node");
          node = args.node;
        } else {
          const nodes = resources.filter((r) => r.type === "node");
          if (nodes.length === 0) throw new Error("no nodes found in cluster resources");
          node = nodes[0].node;
        }
      }

      const body: Record<string, unknown> = {
        vmid: args.vmid,
        restore: 1,
      };
      // PVE API asymmetry: QEMU restore takes the archive in `archive`, but LXC
      // restore reuses the `ostemplate` field to point at the backup volume.
      if (type === "qemu") body.archive = args.archive;
      else body.ostemplate = args.archive;
      if (existing && args.force === true) body.force = 1;
      if (args.storage) body.storage = args.storage;
      if (args.pool) body.pool = args.pool;
      if (args.unique === true && type === "qemu") body.unique = 1;

      const upid = await client.post<string>(`/nodes/${node}/${type}`, body);
      const task = await resolveTaskWait(client, upid, args);
      return jsonToolResult({
        vmid: args.vmid,
        node,
        type,
        archive: args.archive,
        overwrite: Boolean(existing),
        upid,
        ...(task ? { task } : {}),
      });
    },
  };
}
