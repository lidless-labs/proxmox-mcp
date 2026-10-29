import { isIP } from "node:net";
import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite, assertEnvFlag } from "../gates.ts";
import { taskWaitFields, resolveTaskWait, type TaskWaitArgs } from "./task-wait.ts";

const Schema = Type.Object(
  {
    node: Type.String({ minLength: 1, description: "Node to download onto." }),
    storage: Type.String({ minLength: 1, description: "Target storage ID (must allow iso/vztmpl content)." }),
    content: Type.Union([Type.Literal("iso"), Type.Literal("vztmpl")], {
      description: "Content type: 'iso' for an install image, 'vztmpl' for a container template.",
    }),
    url: Type.String({ minLength: 1, description: "HTTP(S) URL to download from." }),
    filename: Type.String({ minLength: 1, description: "Destination filename on the storage." }),
    checksum: Type.Optional(Type.String({ minLength: 1, description: "Expected checksum of the download." })),
    checksum_algorithm: Type.Optional(
      Type.Union(
        [Type.Literal("md5"), Type.Literal("sha1"), Type.Literal("sha256"), Type.Literal("sha512")],
        { description: "Algorithm for the checksum." },
      ),
    ),
    verify_certificates: Type.Optional(
      Type.Boolean({ description: "Verify the source server's TLS cert (default true)." }),
    ),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
    ...taskWaitFields,
  },
  { additionalProperties: false },
);

const NAME = "proxmox_download_url";

function approvedImageUrl(raw: string): string {
  const parse = (value: string): URL => {
    let url: URL;
    try { url = new URL(value); } catch { throw new ToolInputError(`${NAME}: invalid image URL`); }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (value !== value.trim() || /[\\\x00-\x20\x7f]/.test(value) || url.protocol !== "https:" || url.username || url.password || url.hash || url.port ||
        isIP(host) || !host.includes(".") || host.endsWith(".") ||
        /(?:^|\.)(?:localhost|local|internal|invalid|test|onion)$/.test(host) || host.endsWith(".home.arpa")) {
      throw new ToolInputError(`${NAME}: image source must be an approved HTTPS origin with no credentials, IP literal, alternate port, or fragment`);
    }
    return url;
  };
  const url = parse(raw);
  const allowed = (process.env.PROXMOX_DOWNLOAD_ALLOWED_ORIGINS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const origins = allowed.map((origin) => {
    const parsed = parse(origin);
    if (parsed.pathname !== "/" || parsed.search) throw new ToolInputError(`${NAME}: allowlist entries must be HTTPS origins`);
    return parsed.origin;
  });
  if (!origins.includes(url.origin)) throw new ToolInputError(`${NAME}: image source origin is not approved`);
  return url.href;
}

export function createProxmoxDownloadUrlTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: download url",
    description:
      "Download an ISO or container template from a URL onto a storage (POST /nodes/{node}/storage/{storage}/download-url). Requires an operator HTTPS-origin allowlist and egress enforcement at the Proxmox fetch boundary. Optional checksum verification. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        node: string;
        storage: string;
        content: "iso" | "vztmpl";
        url: string;
        filename: string;
        checksum?: string;
        checksum_algorithm?: string;
        verify_certificates?: boolean;
        confirm: boolean;
      } & TaskWaitArgs>(Schema, raw, NAME);
      assertSafePathSegment(args.node, "node");
      assertSafePathSegment(args.storage, "storage");
      assertEnvFlag("PROXMOX_DOWNLOAD_EGRESS_ENFORCED", NAME);
      const url = approvedImageUrl(args.url);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args.filename)) {
        throw new ToolInputError(`${NAME}: filename must be a single safe basename`);
      }
      if (args.verify_certificates === false) {
        throw new ToolInputError(`${NAME}: source certificate verification cannot be disabled`);
      }
      if (args.checksum && !args.checksum_algorithm) {
        throw new ToolInputError(`${NAME}: checksum_algorithm is required when checksum is set`);
      }
      const body: Record<string, unknown> = {
        content: args.content,
        url,
        filename: args.filename,
      };
      if (args.checksum) body.checksum = args.checksum;
      if (args.checksum_algorithm) body["checksum-algorithm"] = args.checksum_algorithm;
      body["verify-certificates"] = 1;
      const client = getClient();
      const upid = await client.post<string>(
        `/nodes/${args.node}/storage/${args.storage}/download-url`,
        body,
      );
      const task = await resolveTaskWait(client, upid, args);
      return jsonToolResult({
        node: args.node,
        storage: args.storage,
        content: args.content,
        filename: args.filename,
        upid,
        ...(task ? { task } : {}),
      });
    },
  };
}
