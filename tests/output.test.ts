import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DEFAULT_MAX_RESULT_BYTES, finalizeToolResult, resolveMaxResultBytes } from "../src/output.ts";
import { _resetForTests, registerSecret } from "../src/security.ts";
import { createMcpServer } from "../src/server.ts";
import { classifyToolError, MAX_ERROR_MESSAGE_CHARS } from "../src/errors.ts";
import { ProxmoxClientError } from "../src/proxmox-client.ts";
import { startFakeProxmox, FakeProxmox } from "./fake-proxmox.ts";

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

beforeEach(() => _resetForTests());

describe("resolveMaxResultBytes", () => {
  it("defaults, and ignores values that are not integers of at least 2048", () => {
    expect(resolveMaxResultBytes({})).toBe(DEFAULT_MAX_RESULT_BYTES);
    expect(resolveMaxResultBytes({ PROXMOX_MAX_RESULT_BYTES: "abc" })).toBe(DEFAULT_MAX_RESULT_BYTES);
    expect(resolveMaxResultBytes({ PROXMOX_MAX_RESULT_BYTES: "10" })).toBe(DEFAULT_MAX_RESULT_BYTES);
    expect(resolveMaxResultBytes({ PROXMOX_MAX_RESULT_BYTES: "4096" })).toBe(4096);
  });
});

describe("finalizeToolResult", () => {
  it("passes small results through unchanged", () => {
    const result = text('{"ok":true}');
    expect(finalizeToolResult(result, 4096)).toEqual(result);
  });

  it("replaces an oversized result with a valid JSON envelope under the limit", () => {
    const out = finalizeToolResult(text("x".repeat(10_000)), 4096);
    const body = out.content[0].text;
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(4096);
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({ truncated: true, original_bytes: 10_000, limit_bytes: 4096 });
    expect(typeof parsed.preview).toBe("string");
  });

  it("does not split a multi-byte character at the cut", () => {
    const out = finalizeToolResult(text("é".repeat(5_000)), 4096);
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed.preview).not.toContain("�");
    expect(Buffer.byteLength(out.content[0].text, "utf8")).toBeLessThanOrEqual(4096);
  });

  it("masks registered secrets on the success path", () => {
    registerSecret("example-secret-value");
    const out = finalizeToolResult(text('{"content":"key=example-secret-value"}'), 4096);
    expect(out.content[0].text).not.toContain("example-secret-value");
    expect(out.content[0].text).toContain("REDACTED");
  });

  it("redacts before truncating so a secret on the cut line cannot leak a fragment", () => {
    registerSecret("example-secret-value");
    const padding = "a".repeat(4096 - 512 - 8);
    const out = finalizeToolResult(text(`${padding}example-secret-value tail ${"b".repeat(8000)}`), 4096);
    expect(out.content[0].text).not.toContain("example-s");
  });

  it("leaves non-text content and non-object results alone", () => {
    const image = { content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] };
    expect(finalizeToolResult(image, 4096)).toEqual(image);
    expect(finalizeToolResult(undefined, 4096)).toBeUndefined();
  });
});

describe("classifyToolError bounds upstream text", () => {
  it("caps a long upstream error body and says how much was dropped", () => {
    const payload = classifyToolError(new ProxmoxClientError(502, "<html>" + "z".repeat(20_000)));
    expect(payload.code).toBe("PROXMOX_HTTP_502");
    expect(payload.error.length).toBeLessThan(MAX_ERROR_MESSAGE_CHARS + 100);
    expect(payload.error).toMatch(/\[truncated \d+ chars\]$/);
  });

  it("leaves short messages untouched", () => {
    expect(classifyToolError(new ProxmoxClientError(403, "permission denied")).error).toBe(
      "Proxmox 403: permission denied",
    );
  });

  it("masks a secret even when it sits at the truncation boundary", () => {
    registerSecret("example-secret-value");
    const message = "p".repeat(MAX_ERROR_MESSAGE_CHARS - 5) + "example-secret-value" + "q".repeat(100);
    const payload = classifyToolError(new Error(message));
    expect(payload.error).not.toContain("example");
  });
});

describe("server applies the result bound end to end", () => {
  let fake: FakeProxmox | null = null;
  afterEach(async () => {
    if (fake) await fake.close();
    fake = null;
    delete process.env.PROXMOX_MAX_RESULT_BYTES;
  });

  it("returns an envelope instead of an oversized tool result", async () => {
    const entries = Array.from({ length: 400 }, (_, i) => ({ type: "qemu", vmid: i + 1, node: "pve", name: `guest-${i}`, status: "running" }));
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/resources?type=vm", status: 200, body: { data: entries } },
    ]);
    process.env.PROXMOX_MAX_RESULT_BYTES = "4096";
    const server = createMcpServer({
      url: fake.baseUrl,
      tokenId: "u@pam!t",
      tokenSecret: "example-secret-value",
      tlsInsecure: false,
      ssh: { host: "pve.example", port: 22, user: "root", keyPath: "/k", vmUser: "root", vmKeyPath: "/k" },
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    try {
      const result = await client.callTool({ name: "proxmox_list_vms", arguments: {} });
      const body = (result.content as Array<{ text: string }>)[0].text;
      expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(4096);
      expect(JSON.parse(body).truncated).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
