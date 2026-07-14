import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, parseTaskUpid } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    upid: Type.String({ minLength: 1, description: "UPID of the running task to stop." }),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_cancel_task";

export function createProxmoxCancelTaskTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: cancel task",
    description:
      "Stop a running Proxmox task by UPID (DELETE /nodes/{node}/tasks/{upid}) - e.g. abort a stuck migration or backup. The node is parsed from the UPID. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ upid: string; confirm: boolean }>(Schema, raw, NAME);
      const { node } = parseTaskUpid(args.upid);
      await getClient().delete(`/nodes/${node}/tasks/${encodeURIComponent(args.upid)}`);
      return jsonToolResult({ upid: args.upid, node, stopped: true });
    },
  };
}
