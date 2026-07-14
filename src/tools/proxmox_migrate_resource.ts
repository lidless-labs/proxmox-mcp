import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs, assertSafePathSegment } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { taskWaitFields, resolveTaskWait, type TaskWaitArgs } from "./task-wait.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID to migrate." }),
    target: Type.String({ minLength: 1, description: "Target node name to migrate to." }),
    online: Type.Optional(
      Type.Boolean({ description: "QEMU: live-migrate a running VM (no downtime)." }),
    ),
    restart: Type.Optional(
      Type.Boolean({ description: "LXC: restart-migrate a running container (brief downtime)." }),
    ),
    with_local_disks: Type.Optional(
      Type.Boolean({ description: "QEMU: also migrate local (non-shared) disks." }),
    ),
    targetstorage: Type.Optional(
      Type.String({ minLength: 1, description: "Map disks onto this storage on the target node." }),
    ),
    bwlimit: Type.Optional(
      Type.Integer({ minimum: 0, description: "Bandwidth limit in KiB/s (0 = unlimited)." }),
    ),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
    ...taskWaitFields,
  },
  { additionalProperties: false },
);

const NAME = "proxmox_migrate_resource";

export function createProxmoxMigrateResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: migrate resource",
    description:
      "Migrate a VM or container to another node (POST /nodes/{node}/{type}/{vmid}/migrate). QEMU supports online (live) migration; LXC uses restart mode. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        vmid: number;
        target: string;
        online?: boolean;
        restart?: boolean;
        with_local_disks?: boolean;
        targetstorage?: string;
        bwlimit?: number;
        confirm: boolean;
      } & TaskWaitArgs>(Schema, raw, NAME);
      assertSafePathSegment(args.target, "target node");
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      if (args.target === node) {
        throw new Error(`vmid ${args.vmid} is already on node ${node}; nothing to migrate.`);
      }
      const body: Record<string, unknown> = { target: args.target };
      if (type === "qemu") {
        if (args.online) body.online = 1;
        if (args.with_local_disks) body["with-local-disks"] = 1;
      } else {
        // LXC cannot live-migrate; restart mode is the runtime-safe equivalent.
        if (args.restart || args.online) body.restart = 1;
      }
      if (args.targetstorage) body.targetstorage = args.targetstorage;
      if (typeof args.bwlimit === "number") body.bwlimit = args.bwlimit;
      const upid = await client.post<string>(`/nodes/${node}/${type}/${args.vmid}/migrate`, body);
      const task = await resolveTaskWait(client, upid, args);
      return jsonToolResult({ vmid: args.vmid, node, type, target: args.target, upid, ...(task ? { task } : {}) });
    },
  };
}
