import type { ProxmoxClient } from "../proxmox-client.ts";
import type { ExecResult } from "../ssh-executor.ts";
import { execViaGuestAgent } from "../guest-agent.ts";
import type { SshExecutor, SshExecutorFactory } from "./_util.ts";
import { resolveResource } from "./_util.ts";
import { missingQemuSshHostMessage, qemuSshTarget, resolveQemuSshHost, type VmSshDefaults } from "./ssh-target.ts";

export type ExecBackend = "ssh" | "guest-agent";

/** Which QEMU exec backend to use, from PROXMOX_EXEC_BACKEND (default ssh). */
export function resolveExecBackend(): ExecBackend {
  const v = (process.env.PROXMOX_EXEC_BACKEND ?? "ssh").toLowerCase();
  return v === "guest-agent" || v === "agent" ? "guest-agent" : "ssh";
}

/**
 * Run a command inside a QEMU VM via the configured backend: direct SSH
 * (default) or the qemu-guest-agent API (PROXMOX_EXEC_BACKEND=guest-agent).
 * LXC always uses pct-over-SSH and never reaches this path.
 */
export async function execInQemuGuest(
  client: ProxmoxClient,
  ssh: SshExecutor,
  node: string,
  vmid: number,
  command: string,
  timeoutMs: number,
  vmDefaults: VmSshDefaults,
  stdin?: string,
): Promise<ExecResult> {
  if (resolveExecBackend() === "guest-agent") {
    return execViaGuestAgent(client, node, vmid, command, timeoutMs, stdin);
  }
  const host = await resolveQemuSshHost(client, node, vmid);
  if (!host) throw new Error(missingQemuSshHostMessage(vmid));
  return ssh.execViaDirectSsh(qemuSshTarget(vmid, host, vmDefaults), command, timeoutMs, stdin);
}

export interface GuestCommandResult {
  node: string;
  type: "lxc" | "qemu";
  result: ExecResult;
}

export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function assertAbsoluteGuestPath(path: string, toolName: string): void {
  if (!path.startsWith("/")) throw new Error(`${toolName} path must be absolute`);
  if (path.includes("\0")) throw new Error(`${toolName} path cannot contain NUL bytes`);
}

export async function runGuestCommand(
  client: ProxmoxClient,
  ssh: SshExecutor,
  vmDefaults: VmSshDefaults,
  vmid: number,
  command: string,
  timeoutMs: number,
  stdin?: string,
): Promise<GuestCommandResult> {
  const { node, type } = await resolveResource(client, vmid);
  if (type === "lxc") {
    return { node, type, result: await ssh.execInLxc(vmid, command, timeoutMs, stdin) };
  }
  const result = await execInQemuGuest(client, ssh, node, vmid, command, timeoutMs, vmDefaults, stdin);
  return { node, type, result };
}

export function getSshExecutor(getSsh: SshExecutorFactory): SshExecutor {
  return getSsh();
}
