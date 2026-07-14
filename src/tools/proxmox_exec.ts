import { Type } from "@sinclair/typebox";
import type { ClientFactory, SshExecutorFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { type VmSshDefaults } from "./ssh-target.ts";
import { execInQemuGuest } from "./guest-command.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM id." }),
    command: Type.String({ minLength: 1, description: "Shell command to run inside the resource." }),
    timeout: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 3600, description: "Timeout in seconds (default 30)." }),
    ),
    confirm: Type.Boolean({ description: "Must be true to execute. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_exec";

export function createProxmoxExecTool(
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  return {
    name: NAME,
    label: "proxmox: exec in container or VM",
    description:
      "Run a shell command inside an LXC container (via SSH+pct exec) or QEMU VM (via direct SSH by default, or the qemu-guest-agent API when PROXMOX_EXEC_BACKEND=guest-agent - no in-guest SSH key needed). Returns stdout/stderr/exit_code. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; command: string; timeout?: number; confirm: boolean }>(Schema, raw, NAME);
      const timeoutMs = (args.timeout ?? 30) * 1000;
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const ssh = getSsh();
      if (type === "lxc") {
        const result = await ssh.execInLxc(args.vmid, args.command, timeoutMs);
        return jsonToolResult({
          vmid: args.vmid,
          type,
          stdout: result.stdout,
          stderr: result.stderr,
          exit_code: result.exitCode,
        });
      }
      const result = await execInQemuGuest(client, ssh, node, args.vmid, args.command, timeoutMs, vmDefaults);
      return jsonToolResult({
        vmid: args.vmid,
        type,
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
      });
    },
  };
}
