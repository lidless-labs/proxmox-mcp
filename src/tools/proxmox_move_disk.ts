import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs, assertSafePathSegment } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { taskWaitFields, resolveTaskWait, type TaskWaitArgs } from "./task-wait.ts";

const DISK_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
    disk: Type.String({
      minLength: 1,
      description: "Disk/volume key to move, e.g. 'scsi0' (QEMU) or 'rootfs'/'mp0' (LXC).",
    }),
    target_storage: Type.String({ minLength: 1, description: "Target storage to move the disk onto." }),
    delete_source: Type.Optional(
      Type.Boolean({ description: "Delete the original disk after a successful move (default false)." }),
    ),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
    ...taskWaitFields,
  },
  { additionalProperties: false },
);

const NAME = "proxmox_move_disk";

export function createProxmoxMoveDiskTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: move disk",
    description:
      "Relocate a VM disk (POST /nodes/{node}/qemu/{vmid}/move_disk) or container volume (POST /nodes/{node}/lxc/{vmid}/move_volume) to another storage. Optionally deletes the source after a successful copy. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        vmid: number;
        disk: string;
        target_storage: string;
        delete_source?: boolean;
        confirm: boolean;
      } & TaskWaitArgs>(Schema, raw, NAME);
      if (!DISK_KEY_RE.test(args.disk)) {
        throw new Error(`${NAME}: invalid disk key "${args.disk}"`);
      }
      assertSafePathSegment(args.target_storage, "target_storage");
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const del = args.delete_source === true ? 1 : 0;
      let upid: string | null;
      if (type === "qemu") {
        upid = await client.post<string>(`/nodes/${node}/qemu/${args.vmid}/move_disk`, {
          disk: args.disk,
          storage: args.target_storage,
          delete: del,
        });
      } else {
        upid = await client.post<string>(`/nodes/${node}/lxc/${args.vmid}/move_volume`, {
          volume: args.disk,
          storage: args.target_storage,
          delete: del,
        });
      }
      const task = await resolveTaskWait(client, upid, args);
      return jsonToolResult({
        vmid: args.vmid,
        node,
        type,
        disk: args.disk,
        target_storage: args.target_storage,
        deleted_source: del === 1,
        upid,
        ...(task ? { task } : {}),
      });
    },
  };
}
