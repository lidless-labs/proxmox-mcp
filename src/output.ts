import { redact } from "./security.ts";

// Executor-style MCP clients refuse tool results above roughly 100 KB, and a model
// context is a poor place for megabytes of log text anyway. Results above the limit are
// replaced by a short JSON envelope that says so, instead of being cut mid-document.
export const DEFAULT_MAX_RESULT_BYTES = 100_000;
const MIN_MAX_RESULT_BYTES = 2_048;
// Room for the envelope fields wrapped around the preview.
const ENVELOPE_RESERVE_BYTES = 512;

export function resolveMaxResultBytes(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.PROXMOX_MAX_RESULT_BYTES;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_RESULT_BYTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_MAX_RESULT_BYTES) return DEFAULT_MAX_RESULT_BYTES;
  return parsed;
}

function truncateUtf8(text: string, maxBytes: number): string {
  const cut = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
  // A cut inside a multi-byte character decodes to a trailing replacement character.
  return cut.replace(/�+$/, "");
}

function boundText(text: string, maxBytes: number): string {
  const originalBytes = Buffer.byteLength(text, "utf8");
  if (originalBytes <= maxBytes) return text;
  const envelope = (previewBytes: number): string =>
    JSON.stringify({
      truncated: true,
      original_bytes: originalBytes,
      limit_bytes: maxBytes,
      note: "Result exceeded the size limit. Narrow the request (filters, limit, a smaller range) and retry.",
      preview: truncateUtf8(text, previewBytes),
    });
  // JSON escaping (quotes, backslashes, control characters) makes the encoded preview
  // longer than its source, so shrink the preview until the whole envelope fits. Each
  // removed source byte removes at least one encoded byte, so this converges quickly.
  let previewBytes = Math.max(0, maxBytes - ENVELOPE_RESERVE_BYTES);
  let out = envelope(previewBytes);
  while (previewBytes > 0 && Buffer.byteLength(out, "utf8") > maxBytes) {
    previewBytes = Math.max(0, previewBytes - (Buffer.byteLength(out, "utf8") - maxBytes));
    out = envelope(previewBytes);
  }
  return out;
}

interface TextContentLike {
  type: string;
  text?: unknown;
  [key: string]: unknown;
}

// Applied to every successful tool result before it leaves the server: registered
// secrets are masked in the text, then the text is held to the size limit. Redaction
// runs first so a secret cannot survive by sitting in the truncated preview.
export function finalizeToolResult<T>(result: T, maxBytes: number = resolveMaxResultBytes()): T {
  if (!result || typeof result !== "object") return result;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return result;
  const bounded = content.map((item: TextContentLike) => {
    if (!item || item.type !== "text" || typeof item.text !== "string") return item;
    return { ...item, text: boundText(redact(item.text) as string, maxBytes) };
  });
  return { ...result, content: bounded };
}
