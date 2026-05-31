import type { ProxmoxClient } from "../proxmox-client.ts";
import type { ExecResult } from "../ssh-executor.ts";
import type { SshExecutor, SshExecutorFactory } from "./_util.ts";
import { resolveResource } from "./_util.ts";
import { missingQemuSshHostMessage, qemuSshTarget, resolveQemuSshHost, type VmSshDefaults } from "./ssh-target.ts";

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
  const host = await resolveQemuSshHost(client, node, vmid);
  if (!host) throw new Error(missingQemuSshHostMessage(vmid));
  const target = qemuSshTarget(vmid, host, vmDefaults);
  return { node, type, result: await ssh.execViaDirectSsh(target, command, timeoutMs, stdin) };
}

export function getSshExecutor(getSsh: SshExecutorFactory): SshExecutor {
  return getSsh();
}
