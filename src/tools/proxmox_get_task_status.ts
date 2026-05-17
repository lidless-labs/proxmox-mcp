import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, parseTaskUpid } from "./_util.ts";

const Schema = Type.Object(
  {
    upid: Type.String({
      minLength: 1,
      description: "Task UPID returned by a prior write tool (e.g. start, stop, snapshot, backup).",
    }),
  },
  { additionalProperties: false },
);

interface TaskStatus {
  upid: string;
  node: string;
  pid?: number;
  pstart?: number;
  starttime?: number;
  type?: string;
  id?: string;
  user?: string;
  status?: string;
  exitstatus?: string;
}

export function createProxmoxGetTaskStatusTool(getClient: ClientFactory) {
  return {
    name: "proxmox_get_task_status",
    label: "proxmox: get task status",
    description:
      "Get the current status of a Proxmox task by UPID (running/stopped, exit status) via GET /nodes/{node}/tasks/{upid}/status. Node is parsed from the UPID.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = raw as { upid: string };
      const { node } = parseTaskUpid(args.upid);
      const client = getClient();
      const status = await client.get<TaskStatus>(
        `/nodes/${node}/tasks/${encodeURIComponent(args.upid)}/status`,
      );
      return jsonToolResult(status);
    },
  };
}
