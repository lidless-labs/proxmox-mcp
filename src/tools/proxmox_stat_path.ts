import { Type } from "@sinclair/typebox";
import type { ClientFactory, SshExecutorFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { assertAbsoluteGuestPath, runGuestCommand, shellSingleQuote } from "./guest-command.ts";
import type { VmSshDefaults } from "./ssh-target.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM id." }),
    path: Type.String({ minLength: 1, description: "Absolute path inside the guest." }),
    confirm: Type.Boolean({ description: "Must be true to inspect guest filesystem metadata." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_stat_path";

export function createProxmoxStatPathTool(
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  return {
    name: NAME,
    label: "proxmox: stat guest path",
    description:
      "Return structured metadata for a path inside an LXC container or QEMU VM. Gated guest read; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; path: string; confirm: boolean }>(Schema, raw, NAME);
      assertAbsoluteGuestPath(args.path, NAME);
      const command = `stat -Lc '%F|%s|%U|%G|%a|%Y|%n' -- ${shellSingleQuote(args.path)}`;
      const { node, type, result } = await runGuestCommand(
        getClient(),
        getSsh(),
        vmDefaults,
        args.vmid,
        command,
        30_000,
      );
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `stat failed with exit code ${result.exitCode}`);
      const [file_type, size, owner, group, mode, mtime, name] = result.stdout.trimEnd().split("|");
      return jsonToolResult({
        vmid: args.vmid,
        node,
        type,
        path: args.path,
        file_type,
        size: Number(size),
        owner,
        group,
        mode,
        mtime: Number(mtime),
        name,
      });
    },
  };
}
