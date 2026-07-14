import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs, assertSafePathSegment, ToolInputError } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
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

export function createProxmoxDownloadUrlTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: download url",
    description:
      "Download an ISO or container template from a URL onto a storage (POST /nodes/{node}/storage/{storage}/download-url). Optional checksum verification. Tier-2 write; requires confirm:true.",
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
      if (!/^https?:\/\//i.test(args.url)) {
        throw new ToolInputError(`${NAME}: url must be http(s)`);
      }
      if (args.checksum && !args.checksum_algorithm) {
        throw new ToolInputError(`${NAME}: checksum_algorithm is required when checksum is set`);
      }
      const body: Record<string, unknown> = {
        content: args.content,
        url: args.url,
        filename: args.filename,
      };
      if (args.checksum) body.checksum = args.checksum;
      if (args.checksum_algorithm) body["checksum-algorithm"] = args.checksum_algorithm;
      if (args.verify_certificates === false) body["verify-certificates"] = 0;
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
