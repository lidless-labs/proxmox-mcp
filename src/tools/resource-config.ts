import { Type } from "@sinclair/typebox";
import { ToolInputError } from "./_util.ts";

// PVE config keys are lowercase-ish identifiers, optionally suffixed with an
// index (net0, scsi1, smbios1). Validate before form-encoding so a malformed
// key can't smuggle a second field into the request body.
const CONFIG_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/** Shared TypeBox fields for both VM and container config-edit tools. */
export const configEditFields = {
  cores: Type.Optional(Type.Integer({ minimum: 1, description: "CPU cores." })),
  memory: Type.Optional(Type.Integer({ minimum: 16, description: "RAM in MiB." })),
  description: Type.Optional(Type.String({ description: "Free-form description / notes." })),
  onboot: Type.Optional(Type.Boolean({ description: "Start on host boot." })),
  tags: Type.Optional(Type.String({ description: "Semicolon-delimited Proxmox tags." })),
  cpulimit: Type.Optional(Type.Number({ minimum: 0, description: "CPU limit (0 = unlimited)." })),
  cpuunits: Type.Optional(Type.Integer({ minimum: 1, description: "CPU weight / shares." })),
  protection: Type.Optional(
    Type.Boolean({ description: "Protection flag (blocks destroy/disk-remove)." }),
  ),
  set: Type.Optional(
    Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]), {
      description:
        "Arbitrary PVE config keys to set, e.g. {\"net0\":\"virtio,bridge=vmbr0\",\"bios\":\"ovmf\"}. Escape hatch for keys not exposed as typed fields.",
    }),
  ),
  unset: Type.Optional(
    Type.Array(Type.String(), {
      description: "Config keys to unset/revert to default, e.g. [\"tags\",\"description\"].",
    }),
  ),
  digest: Type.Optional(
    Type.String({
      description: "SHA1 config digest for optimistic concurrency; edit is rejected if config changed.",
    }),
  ),
} as const;

function normalize(v: unknown): string | number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  return String(v);
}

export interface ConfigEditArgs {
  cores?: number;
  memory?: number;
  description?: string;
  onboot?: boolean;
  tags?: string;
  cpulimit?: number;
  cpuunits?: number;
  protection?: boolean;
  set?: Record<string, string | number | boolean>;
  unset?: string[];
  digest?: string;
}

/**
 * Build the PVE config PUT body from typed common fields plus the generic
 * `set`/`unset` escape hatches. Throws if no mutation was supplied (a no-op
 * edit is almost always a mistake) or a key is malformed.
 */
export function buildConfigBody(
  args: ConfigEditArgs,
  extraTyped: Record<string, unknown>,
  toolName: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const typed: Record<string, unknown> = {
    cores: args.cores,
    memory: args.memory,
    description: args.description,
    onboot: args.onboot,
    tags: args.tags,
    cpulimit: args.cpulimit,
    cpuunits: args.cpuunits,
    protection: args.protection,
    ...extraTyped,
  };
  for (const [k, v] of Object.entries(typed)) {
    if (v !== undefined) body[k] = normalize(v);
  }
  if (args.set) {
    for (const [k, v] of Object.entries(args.set)) {
      if (!CONFIG_KEY_RE.test(k)) {
        throw new ToolInputError(`${toolName}: invalid config key "${k}" in set`);
      }
      body[k] = normalize(v);
    }
  }
  const unset = (args.unset ?? []).filter((k) => k.length > 0);
  for (const k of unset) {
    if (!CONFIG_KEY_RE.test(k)) {
      throw new ToolInputError(`${toolName}: invalid config key "${k}" in unset`);
    }
  }
  if (unset.length > 0) body.delete = unset.join(",");
  if (args.digest) body.digest = args.digest;

  const mutations = Object.keys(body).filter((k) => k !== "digest");
  if (mutations.length === 0) {
    throw new ToolInputError(
      `${toolName}: no config changes supplied. Provide at least one field, a "set" entry, or an "unset" key.`,
    );
  }
  return body;
}
