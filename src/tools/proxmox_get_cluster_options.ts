import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });
const NAME = "proxmox_get_cluster_options";

export function createProxmoxGetClusterOptionsTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: get cluster options",
    description:
      "Read datacenter-wide options (GET /cluster/options): keyboard, MAC prefix, allowed tags, default migration settings, etc. Tier-1 read.",
    parameters: Schema,
    execute: async () => {
      const options = await getClient().get<Record<string, unknown>>("/cluster/options");
      return jsonToolResult({ options });
    },
  };
}
