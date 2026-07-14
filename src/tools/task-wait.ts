import { Type } from "@sinclair/typebox";
import type { ProxmoxClient } from "../proxmox-client.ts";
import { parseTaskUpid } from "./_util.ts";

/** Optional fields that let a task-producing tool block until the task finishes. */
export const taskWaitFields = {
  wait: Type.Optional(
    Type.Boolean({ description: "Block until the task finishes and include its exit status in the result." }),
  ),
  wait_timeout: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 3600, description: "Max seconds to wait when wait:true (default 120)." }),
  ),
} as const;

export interface TaskWaitArgs {
  wait?: boolean;
  wait_timeout?: number;
}

export interface TaskOutcome {
  done: boolean;
  polls: number;
  status?: string;
  exitstatus?: string;
  ok?: boolean;
}

interface RawTaskStatus {
  status?: string;
  exitstatus?: string;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * If args.wait is set and a UPID was returned, poll the task to completion.
 * Returns undefined when waiting was not requested or there is no UPID to wait
 * on (e.g. a synchronous config edit that returned null). `ok` is true only for
 * an exitstatus of "OK".
 */
export async function resolveTaskWait(
  client: ProxmoxClient,
  upid: string | null | undefined,
  args: TaskWaitArgs,
  intervalMs = 1000,
): Promise<TaskOutcome | undefined> {
  if (!args.wait || typeof upid !== "string" || !upid.startsWith("UPID:")) return undefined;
  const { node } = parseTaskUpid(upid);
  const deadline = Date.now() + (args.wait_timeout ?? 120) * 1000;
  let polls = 0;
  let last: RawTaskStatus | null = null;
  while (Date.now() <= deadline) {
    polls += 1;
    last = await client.get<RawTaskStatus>(`/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`);
    if (last.status === "stopped" || last.exitstatus) {
      return { done: true, polls, status: last.status, exitstatus: last.exitstatus, ok: last.exitstatus === "OK" };
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
  return { done: false, polls, status: last?.status };
}
