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

describe("finalizeToolResult masks secrets that JSON escaping changed", () => {
  it("masks a secret with a quote, backslash or newline in a serialized result", () => {
    const secret = 'pa"ss\\wo\nrd-12345';
    registerSecret(secret);
    const result = text(JSON.stringify({ stdout: `login ${secret} ok`, other: secret }));
    const out = finalizeToolResult(result, 4096).content[0].text;
    expect(out).not.toContain("ss");
    expect(out).not.toContain(JSON.stringify(secret).slice(1, -1));
    expect(out).toContain("REDACTED");
  });

  it("keeps the result valid JSON when the secret starts with a quote or backslash", () => {
    for (const secret of ['"leading-quote-12345', "\\leading-slash-12345"]) {
      registerSecret(secret);
      const out = finalizeToolResult(text(JSON.stringify({ stdout: `v=${secret}` })), 4096).content[0].text;
      expect(() => JSON.parse(out), out).not.toThrow();
      expect(out).not.toContain("leading-");
    }
  });

  it("still masks the raw form", () => {
    registerSecret("example-secret-value");
    expect(finalizeToolResult(text("x example-secret-value y"), 4096).content[0].text).toBe("x REDACTED y");
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

describe("deferred search results get the same treatment", () => {
  afterEach(() => {
    delete process.env.PROXMOX_DEFERRED_TOOLS;
    delete process.env.PROXMOX_MAX_RESULT_BYTES;
  });

  it("masks a registered secret and bounds a huge query echoed by proxmox_search_tools", async () => {
    process.env.PROXMOX_DEFERRED_TOOLS = "1";
    process.env.PROXMOX_MAX_RESULT_BYTES = "4096";
    const server = createMcpServer({
      url: "http://127.0.0.1:9",
      tokenId: "u@pam!t",
      tokenSecret: "example-secret-value",
      tlsInsecure: false,
      ssh: { host: "pve.example", port: 22, user: "root", keyPath: "/k", vmUser: "root", vmKeyPath: "/k" },
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    try {
      const small = await client.callTool({
        name: "proxmox_search_tools",
        arguments: { query: "list vms example-secret-value" },
      });
      expect((small.content as Array<{ text: string }>)[0].text).not.toContain("example-secret-value");

      const big = await client.callTool({
        name: "proxmox_search_tools",
        arguments: { query: "list vms " + "z".repeat(50_000) },
      });
      const body = (big.content as Array<{ text: string }>)[0].text;
      expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(4096);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("error results get the same bound", () => {
  afterEach(() => {
    delete process.env.PROXMOX_MAX_RESULT_BYTES;
  });

  it("bounds the unknown tool error, whatever the name length", async () => {
    process.env.PROXMOX_MAX_RESULT_BYTES = "4096";
    const server = createMcpServer({
      url: "http://127.0.0.1:9",
      tokenId: "u@pam!t",
      tokenSecret: "example-secret-value",
      tlsInsecure: false,
      ssh: { host: "pve.example", port: 22, user: "root", keyPath: "/k", vmUser: "root", vmKeyPath: "/k" },
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    try {
      const result = await client.callTool({ name: "x".repeat(50_000), arguments: {} });
      const body = (result.content as Array<{ text: string }>)[0].text;
      expect(result.isError).toBe(true);
      expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(4096);
    } finally {
      await client.close();
      await server.close();
    }
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
