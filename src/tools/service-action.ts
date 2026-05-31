import { Type } from "@sinclair/typebox";
import type { ClientFactory, SshExecutorFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { runGuestCommand, shellSingleQuote } from "./guest-command.ts";
import type { VmSshDefaults } from "./ssh-target.ts";

type ServiceAction = "start" | "stop" | "restart";

interface ServiceActionArgs {
  vmid: number;
  service: string;
  confirm: boolean;
}

function parseSystemctlShow(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.trimEnd().split("\n")) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function schemaFor(action: ServiceAction) {
  return Type.Object(
    {
      vmid: Type.Integer({ minimum: 1, description: "Container or VM id." }),
      service: Type.String({ minLength: 1, description: `systemd service name to ${action} inside the guest.` }),
      confirm: Type.Boolean({ description: `Must be true to ${action} a guest service.` }),
    },
    { additionalProperties: false },
  );
}

export function createServiceActionTool(
  action: ServiceAction,
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  const name = `proxmox_service_${action}`;
  const schema = schemaFor(action);
  return {
    name,
    label: `proxmox: guest service ${action}`,
    description:
      `${action[0].toUpperCase()}${action.slice(1)} a systemd service inside an LXC container or QEMU VM. Tier-2 write; requires confirm:true.`,
    parameters: schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, name);
      const args = validateToolArgs<ServiceActionArgs>(schema, raw, name);
      if (args.service.includes("\0")) throw new Error(`${name} service cannot contain NUL bytes`);
      const quoted = shellSingleQuote(args.service);
      const command =
        `systemctl ${action} -- ${quoted} && systemctl show --no-pager --property=Id,LoadState,ActiveState,SubState,UnitFileState,Description -- ${quoted}`;
      const { node, type, result } = await runGuestCommand(
        getClient(),
        getSsh(),
        vmDefaults,
        args.vmid,
        command,
        60_000,
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `service_${action} failed with exit code ${result.exitCode}`);
      }
      return jsonToolResult({
        vmid: args.vmid,
        node,
        type,
        service: args.service,
        action,
        status: parseSystemctlShow(result.stdout),
      });
    },
  };
}
