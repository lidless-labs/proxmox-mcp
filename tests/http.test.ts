import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer, type HttpServerHandle } from "../src/http.ts";
import { startFakeProxmox, type FakeProxmox } from "./fake-proxmox.ts";

const TOKEN = randomUUID();
const env = {
  PROXMOX_URL: "https://proxmox.example.com:8006",
  PROXMOX_TOKEN_ID: "test@pve!mcp",
  PROXMOX_TOKEN_SECRET: "test-upstream-secret",
  PROXMOX_MCP_HTTP_TOKEN: TOKEN,
  PROXMOX_MCP_HTTP_PORT: "0",
  PROXMOX_MCP_HTTP_HOST: undefined,
  PROXMOX_DEFERRED_TOOLS: undefined,
  PROXMOX_ENABLE_DESTRUCTIVE: undefined,
};
let http: HttpServerHandle | undefined;
let fake: FakeProxmox | undefined;
const connections: { client: Client; transport: StreamableHTTPClientTransport }[] = [];
afterEach(async () => {
  for (const { client, transport } of connections.splice(0)) {
    await transport.terminateSession().catch(() => undefined);
    await client.close();
  }
  await http?.close();
  await fake?.close();
  http = undefined;
  fake = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function configure(extra = {}) {
  for (const [name, value] of Object.entries({ ...env, ...extra })) vi.stubEnv(name, value);
}
async function start(extra = {}) {
  configure(extra);
  http = await createHttpServer();
  return `http://localhost:${http.port}`;
}
async function connect(url: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "http-test", version: "1" });
  connections.push({ client, transport });
  await client.connect(transport);
  return { client, transport };
}

describe("authenticated Streamable HTTP", () => {
  it.each([undefined, "Bearer wrong-token"])("rejects invalid authentication: %s", async (authorization) => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, { method: "POST", headers: authorization ? { authorization } : {} });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.text()).toBe("Unauthorized");
  });

  it("exposes only liveness without authentication", async () => {
    const response = await fetch(`${await start()}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("lists tools using the SDK client and terminates its session", async () => {
    const url = await start();
    const { client, transport } = await connect(url);
    const result = await client.listTools();
    expect(result.tools).toHaveLength(96);
    expect(result.tools.some((t) => t.name === "proxmox_status")).toBe(true);
    const id = transport.sessionId;
    expect(id).toBeTruthy();
    await transport.terminateSession();
    const stale = await fetch(`${url}/mcp`, {
      headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": id!, accept: "text/event-stream" },
    });
    expect(stale.status).toBe(404);
  });

  it.each([
    { origin: "https://evil.example.com" },
    { origin: "null" },
    { origin: "http://localhost.evil.example.com" },
    { host: "evil.example.com" },
    { host: "localhost@evil.example.com" },
  ])("rejects rebinding headers %j", async (headers) => {
    const url = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${url}/mcp`, { method: "POST", headers: { ...headers, authorization: `Bearer ${TOKEN}` } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("accepts a loopback Origin", async () => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, { method: "POST", headers: { origin: url } });
    expect(response.status).toBe(401);
  });

  it.each([undefined, "", "   ", env.PROXMOX_TOKEN_ID, env.PROXMOX_TOKEN_SECRET,
    `PVEAPIToken=${env.PROXMOX_TOKEN_ID}=${env.PROXMOX_TOKEN_SECRET}`,
  ])("refuses missing, blank, or reused credentials", async (token) => {
    configure({ PROXMOX_MCP_HTTP_TOKEN: token });
    await expect(createHttpServer()).rejects.toThrow(/PROXMOX_MCP_HTTP_TOKEN/);
  });

  it("refuses a token shorter than 32 characters", async () => {
    configure({ PROXMOX_MCP_HTTP_TOKEN: "a".repeat(31) });
    await expect(createHttpServer()).rejects.toThrow(/at least 32 characters/);
  });

  it.each(["0.0.0.0", "::", "[::]"])("refuses wildcard bind host %s", async (host) => {
    configure({ PROXMOX_MCP_HTTP_HOST: host });
    await expect(createHttpServer()).rejects.toThrow(/not a wildcard/);
  });

  it("accepts a token with surrounding whitespace from a secrets file", async () => {
    const url = await start({ PROXMOX_MCP_HTTP_TOKEN: `  ${TOKEN}\n` });
    const { client } = await connect(url);
    expect((await client.listTools()).tools).toHaveLength(96);
  });

  it.each(["-1", "65536", "abc", "3000suffix", "1.5"])("refuses invalid port %s", async (port) => {
    configure({ PROXMOX_MCP_HTTP_PORT: port });
    await expect(createHttpServer()).rejects.toThrow(/PROXMOX_MCP_HTTP_PORT/);
  });

  it("limits request bytes before JSON parsing", async () => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, {
      method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "x".repeat(1_048_577),
    });
    expect(response.status).toBe(413);
  });

  it("limits chunked bodies without a Content-Length", async () => {
    const url = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${url}/mcp`, {
        method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.write("x".repeat(600_000));
      req.end("x".repeat(600_000));
    });
    expect(status).toBe(413);
  });

  it("expires idle sessions even with an SSE channel open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const url = await start();
    const { transport } = await connect(url);
    const id = transport.sessionId!;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    const response = await fetch(`${url}/mcp`, {
      headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": id, accept: "text/event-stream" },
    });
    expect(response.status).toBe(404);
  });

  it("isolates concurrent deferred sessions and requires gates on every call", async () => {
    fake = await startFakeProxmox();
    const url = await start({ PROXMOX_URL: fake.baseUrl, PROXMOX_DEFERRED_TOOLS: "1" });
    const [a, b] = await Promise.all([connect(url), connect(url)]);
    expect(a.transport.sessionId).not.toBe(b.transport.sessionId);
    expect((await a.client.listTools()).tools.map((t) => t.name)).toEqual(["proxmox_search_tools"]);
    await a.client.callTool({ name: "proxmox_search_tools", arguments: { query: "destroy a resource" } });
    expect((await a.client.listTools()).tools.some((t) => t.name === "proxmox_destroy_resource")).toBe(true);
    expect((await b.client.listTools()).tools.map((t) => t.name)).toEqual(["proxmox_search_tools"]);
    // Only A's fully confirmed call may reach the fake. B and A's next call must fail at the argument gate.
    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "1");
    const [confirmed, unconfirmed] = await Promise.all([
      a.client.callTool({ name: "proxmox_destroy_resource", arguments: { vmid: 100, confirm: true, destructive: true } }),
      b.client.callTool({ name: "proxmox_destroy_resource", arguments: { vmid: 100 } }),
    ]);
    expect(confirmed.isError).toBe(true);
    expect(JSON.parse((confirmed.content as { text: string }[])[0].text).code).toBe("PROXMOX_HTTP_404");
    expect(unconfirmed.isError).toBe(true);
    expect(JSON.parse((unconfirmed.content as { text: string }[])[0].text).code).toBe("DESTRUCTIVE_CONFIRMATION_REQUIRED");
    const again = await a.client.callTool({ name: "proxmox_destroy_resource", arguments: { vmid: 100 } });
    expect(again.isError).toBe(true);
    expect(JSON.parse((again.content as { text: string }[])[0].text).code).toBe("DESTRUCTIVE_CONFIRMATION_REQUIRED");
    expect(fake.requests.map((r) => ({ method: r.method, path: r.path }))).toEqual([
      { method: "GET", path: "/api2/json/cluster/resources" },
    ]);
  });

  it("closes active sessions and the listener idempotently", async () => {
    const url = await start();
    await connect(url);
    await Promise.all([http!.close(), http!.close()]);
    await expect(fetch(`${url}/healthz`)).rejects.toThrow();
  });
});
