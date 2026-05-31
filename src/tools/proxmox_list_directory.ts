import { Type } from "@sinclair/typebox";
import type { ClientFactory, SshExecutorFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { assertAbsoluteGuestPath, runGuestCommand, shellSingleQuote } from "./guest-command.ts";
import type { VmSshDefaults } from "./ssh-target.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM id." }),
    path: Type.String({ minLength: 1, description: "Absolute directory path inside the guest." }),
    confirm: Type.Boolean({ description: "Must be true to inspect guest directory contents." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_list_directory";

interface DirectoryEntry {
  name: string;
  kind: string;
  size: number;
  mtime: number;
}

export function createProxmoxListDirectoryTool(
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  return {
    name: NAME,
    label: "proxmox: list guest directory",
    description:
      "List one directory inside an LXC container or QEMU VM. Gated guest read; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; path: string; confirm: boolean }>(Schema, raw, NAME);
      assertAbsoluteGuestPath(args.path, NAME);
      const command = `find ${shellSingleQuote(args.path)} -mindepth 1 -maxdepth 1 -printf '%f\\t%y\\t%s\\t%T@\\n' | sort`;
      const { node, type, result } = await runGuestCommand(
        getClient(),
        getSsh(),
        vmDefaults,
        args.vmid,
        command,
        30_000,
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `list_directory failed with exit code ${result.exitCode}`);
      }
      const entries: DirectoryEntry[] = result.stdout.trimEnd() === ""
        ? []
        : result.stdout.trimEnd().split("\n").map((line) => {
          const [name, kind, size, mtime] = line.split("\t");
          return { name, kind, size: Number(size), mtime: Number(mtime) };
        });
      return jsonToolResult({ vmid: args.vmid, node, type, path: args.path, count: entries.length, entries });
    },
  };
}
