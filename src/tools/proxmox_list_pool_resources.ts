import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";

const Schema = Type.Object(
  {
    pool: Type.Optional(
      Type.String({ minLength: 1, description: "Pool ID to inspect (default mcp-smoke)." }),
    ),
  },
  { additionalProperties: false },
);

export interface PoolMember {
  id?: string;
  type?: string;
  vmid?: number;
  node?: string;
  name?: string;
  tags?: string;
  status?: string;
}

interface PoolDetail {
  poolid?: string;
  comment?: string;
  members?: PoolMember[];
}

const NAME = "proxmox_list_pool_resources";

export function createProxmoxListPoolResourcesTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list pool resources",
    description:
      "List resources assigned to a Proxmox pool (GET /pools/{pool}). Defaults to the mcp-smoke pool for smoke-test audits.",
    parameters: Schema,
    execute: async (_id = "id", raw: Record<string, unknown> = {}) => {
      const args = validateToolArgs<{ pool?: string }>(Schema, raw, NAME);
      const pool = args.pool ?? "mcp-smoke";
      const detail = await getClient().get<PoolDetail>(`/pools/${encodeURIComponent(pool)}`);
      const members = Array.isArray(detail.members) ? detail.members : [];
      return jsonToolResult({
        pool,
        comment: detail.comment,
        count: members.length,
        resources: members,
      });
    },
  };
}
