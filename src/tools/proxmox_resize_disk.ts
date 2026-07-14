import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { taskWaitFields, resolveTaskWait, type TaskWaitArgs } from "./task-wait.ts";

// PVE disk keys: rootfs, mp0.. (LXC); scsi0, virtio0, sata0, ide0, efidisk0 (QEMU).
const DISK_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
// Absolute ("32G") or relative growth ("+2G"). PVE grows only; it refuses shrink.
const SIZE_RE = /^\+?\d+(\.\d+)?[KMGT]?$/;

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
    disk: Type.String({
      minLength: 1,
      description: "Disk key to resize, e.g. 'scsi0', 'virtio0', 'rootfs', 'mp0'.",
    }),
    size: Type.String({
      minLength: 1,
      description: "New size ('32G') or growth increment ('+2G'). PVE grows only; shrink is refused.",
    }),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
    ...taskWaitFields,
  },
  { additionalProperties: false },
);

const NAME = "proxmox_resize_disk";

export function createProxmoxResizeDiskTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: resize disk",
    description:
      "Grow a VM or container disk (PUT /nodes/{node}/{type}/{vmid}/resize) with {disk,size}. Size is absolute ('32G') or an increment ('+2G'); Proxmox only grows disks. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; disk: string; size: string; confirm: boolean } & TaskWaitArgs>(
        Schema,
        raw,
        NAME,
      );
      if (!DISK_KEY_RE.test(args.disk)) {
        throw new ToolInputError(`${NAME}: invalid disk key "${args.disk}"`);
      }
      if (!SIZE_RE.test(args.size)) {
        throw new ToolInputError(
          `${NAME}: invalid size "${args.size}". Use '32G' (absolute) or '+2G' (growth).`,
        );
      }
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const upid = await client.put<string | null>(`/nodes/${node}/${type}/${args.vmid}/resize`, {
        disk: args.disk,
        size: args.size,
      });
      const task = await resolveTaskWait(client, upid, args);
      return jsonToolResult({ vmid: args.vmid, node, type, disk: args.disk, size: args.size, upid: upid ?? null, ...(task ? { task } : {}) });
    },
  };
}
