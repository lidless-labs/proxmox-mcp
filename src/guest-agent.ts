import type { ProxmoxClient } from "./proxmox-client.ts";
import type { ExecResult } from "./ssh-executor.ts";

export class GuestAgentError extends Error {
  constructor(message: string) {
    super(`guest-agent: ${message}`);
    this.name = "GuestAgentError";
  }
}

interface ExecStartResult {
  pid: number;
}

interface ExecStatusResult {
  exited?: number | boolean;
  exitcode?: number;
  signal?: number;
  "out-data"?: string;
  "err-data"?: string;
  "out-truncated"?: number | boolean;
  "err-truncated"?: boolean | number;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a shell command inside a QEMU VM via the qemu-guest-agent API instead of
 * SSH. Needs qemu-guest-agent installed and enabled (`qm set <vmid> --agent 1`)
 * but no in-guest SSH key or network reachability from the MCP host. Wraps the
 * command in `/bin/sh -c` and polls exec-status to completion.
 */
export async function execViaGuestAgent(
  client: ProxmoxClient,
  node: string,
  vmid: number,
  command: string,
  timeoutMs: number,
  stdin?: string,
  pollIntervalMs = 500,
): Promise<ExecResult> {
  const base = `/nodes/${node}/qemu/${vmid}/agent`;
  const body: Record<string, unknown> = { command: ["/bin/sh", "-c", command] };
  if (stdin !== undefined) body["input-data"] = stdin;
  const started = await client.post<ExecStartResult>(`${base}/exec`, body);
  const pid = started?.pid;
  if (typeof pid !== "number") {
    throw new GuestAgentError(`agent/exec did not return a pid for vmid ${vmid}`);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const status = await client.get<ExecStatusResult>(`${base}/exec-status?pid=${pid}`);
    if (status.exited === 1 || status.exited === true) {
      return {
        stdout: status["out-data"] ?? "",
        stderr: status["err-data"] ?? "",
        exitCode: typeof status.exitcode === "number" ? status.exitcode : -1,
      };
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new GuestAgentError(`command in vmid ${vmid} did not finish within ${timeoutMs}ms`);
}
