import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { assertDestructive, assertEnvFlag } from "../gates.ts";
import type { PoolMember } from "./proxmox_list_pool_resources.ts";

const Schema = Type.Object(
  {
    pool: Type.Optional(
      Type.String({ minLength: 1, description: "Pool ID to clean up (default mcp-smoke)." }),
    ),
    name_prefix: Type.Optional(
      Type.String({ minLength: 1, description: "Only delete guest names starting with this prefix (default mcp-smoke-)." }),
    ),
    force: Type.Optional(
      Type.Boolean({ description: "Pass force=1 for LXC cleanup (default false)." }),
    ),
    confirm: Type.Boolean({
      description: "Must be true. Tier-3 destructive gate.",
    }),
    destructive: Type.Boolean({
      description: "Must be true. Tier-3 destructive gate.",
    }),
  },
  { additionalProperties: false },
);

interface PoolDetail {
  members?: PoolMember[];
}

interface CleanupTarget {
  vmid: number;
  node: string;
  type: "lxc" | "qemu";
  name: string;
  status?: string;
}

const NAME = "proxmox_cleanup_smoke_resources";

function normalizeType(type: string | undefined): "lxc" | "qemu" | null {
  if (type === "qemu") return "qemu";
  if (type === "lxc" || type === "openvz") return "lxc";
  return null;
}

function targetFromMember(member: PoolMember, namePrefix: string): CleanupTarget | null {
  const type = normalizeType(member.type);
  const name = member.name ?? "";
  if (!type || typeof member.vmid !== "number" || !member.node || !name.startsWith(namePrefix)) return null;
  return {
    vmid: member.vmid,
    node: member.node,
    type,
    name,
    status: member.status,
  };
}

export function createProxmoxCleanupSmokeResourcesTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: cleanup smoke resources",
    description:
      "Destroy stopped smoke-test LXC/QEMU resources from a pool when their names match the smoke prefix. Tier-3 destructive; requires confirm:true, destructive:true, and PROXMOX_ENABLE_DESTRUCTIVE=1.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", NAME);
      assertDestructive(raw, NAME);
      const args = validateToolArgs<{
        pool?: string;
        name_prefix?: string;
        force?: boolean;
        confirm: boolean;
        destructive: boolean;
      }>(Schema, raw, NAME);
      const pool = args.pool ?? "mcp-smoke";
      const namePrefix = args.name_prefix ?? "mcp-smoke-";
      const force = args.force === true;
      const client = getClient();
      const detail = await client.get<PoolDetail>(`/pools/${encodeURIComponent(pool)}`);
      const members = Array.isArray(detail.members) ? detail.members : [];
      const targets = members
        .map((member) => targetFromMember(member, namePrefix))
        .filter((target): target is CleanupTarget => target !== null);
      const destroyed: Array<CleanupTarget & { upid: string }> = [];
      for (const target of targets) {
        const params = new URLSearchParams();
        params.append("purge", "1");
        params.append("destroy-unreferenced-disks", "1");
        if (force && target.type === "lxc") params.append("force", "1");
        const upid = await client.delete<string>(
          `/nodes/${target.node}/${target.type}/${target.vmid}?${params.toString()}`,
        );
        destroyed.push({ ...target, upid });
      }
      return jsonToolResult({
        pool,
        name_prefix: namePrefix,
        matched: targets.length,
        destroyed,
        skipped: members.length - targets.length,
      });
    },
  };
}
