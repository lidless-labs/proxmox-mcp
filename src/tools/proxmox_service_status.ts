import { Type } from "@sinclair/typebox";
import type { ClientFactory, SshExecutorFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { runGuestCommand, shellSingleQuote } from "./guest-command.ts";
import type { VmSshDefaults } from "./ssh-target.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM id." }),
    service: Type.String({ minLength: 1, description: "systemd service name inside the guest." }),
    confirm: Type.Boolean({ description: "Must be true to inspect guest service state." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_service_status";

function parseSystemctlShow(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.trimEnd().split("\n")) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

export function createProxmoxServiceStatusTool(
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  return {
    name: NAME,
    label: "proxmox: guest service status",
    description:
      "Return systemd service status from inside an LXC container or QEMU VM. Gated guest read; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; service: string; confirm: boolean }>(Schema, raw, NAME);
      if (args.service.includes("\0")) throw new Error(`${NAME} service cannot contain NUL bytes`);
      const command = `systemctl show --no-pager --property=Id,LoadState,ActiveState,SubState,UnitFileState,Description -- ${shellSingleQuote(args.service)}`;
      const { node, type, result } = await runGuestCommand(
        getClient(),
        getSsh(),
        vmDefaults,
        args.vmid,
        command,
        30_000,
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `service_status failed with exit code ${result.exitCode}`);
      }
      const status = parseSystemctlShow(result.stdout);
      return jsonToolResult({ vmid: args.vmid, node, type, service: args.service, status });
    },
  };
}
