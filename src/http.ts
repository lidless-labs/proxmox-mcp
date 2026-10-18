import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./server.ts";
import { resolveConfig } from "./config.ts";
import { registerSecret } from "./security.ts";

const MAX_BODY_BYTES = 1_048_576;
const MAX_SESSIONS = 128;
const SESSION_IDLE_MS = 30 * 60_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function equalSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

function send(response: ServerResponse, status: number, body: string): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", connection: "close" });
  response.end(body);
}

function validHost(value: string | undefined, boundHost: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(`http://${value}`);
    // Require an authority only, without userinfo, paths, whitespace or URL normalization tricks.
    if (!/^(\[[a-f\d:]+\]|[a-z\d.-]+)(:\d+)?$/i.test(value)) return false;
    return LOOPBACK_HOSTS.has(url.hostname) || url.hostname === (boundHost.includes(":") ? `[${boundHost}]` : boundHost).toLowerCase();
  } catch {
    return false;
  }
}

function validOrigin(value: string | undefined): boolean {
  if (value === undefined) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === value && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const length = request.headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new RequestError(413, "Request body too large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  // Keep the socket alive long enough to send 413 on an oversized chunked body.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new RequestError(413, "Request body too large");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Invalid JSON");
  }
}

export interface HttpServerHandle {
  host: string;
  port: number;
  close(): Promise<void>;
}

export async function createHttpServer(): Promise<HttpServerHandle> {
  const env = process.env;
  const token = env.PROXMOX_MCP_HTTP_TOKEN;
  if (!token?.trim()) throw new Error("PROXMOX_MCP_HTTP_TOKEN is required and must not be blank");
  const cfg = resolveConfig(env);
  const url = new URL(cfg.url);
  const credentials = [cfg.tokenId, cfg.tokenSecret, `PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`,
    decodeURIComponent(url.username), decodeURIComponent(url.password)];
  if (credentials.some((credential) => credential && equalSecret(token, credential))) {
    throw new Error("PROXMOX_MCP_HTTP_TOKEN must differ from all Proxmox credentials");
  }
  registerSecret(token);
  const host = env.PROXMOX_MCP_HTTP_HOST ?? "127.0.0.1";
  if (!host.trim() || host.includes("/") || host.includes("@")) {
    throw new Error("PROXMOX_MCP_HTTP_HOST must be a host name or address");
  }
  const portValue = env.PROXMOX_MCP_HTTP_PORT ?? "3100";
  if (!/^\d+$/.test(portValue) || Number(portValue) > 65535) {
    throw new Error("PROXMOX_MCP_HTTP_PORT must be an integer from 0 to 65535");
  }
  const port = Number(portValue);
  type Session = {
    server: ReturnType<typeof createMcpServer>;
    transport: StreamableHTTPServerTransport;
    lastUsed: number;
    active: number;
  };
  const sessions = new Map<string, Session>();
  // Includes initializations in flight, so both capacity and shutdown cover them.
  const resources = new Set<Session>();
  let closing = false;
  const dispose = async (session: Session): Promise<void> => {
    resources.delete(session);
    if (session.transport.sessionId) sessions.delete(session.transport.sessionId);
    await session.server.close();
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (closing) return send(response, 503, "Service unavailable");
    if (!validHost(request.headers.host, host) || !validOrigin(request.headers.origin)) {
      return send(response, 403, "Forbidden");
    }
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.url !== "/mcp") return send(response, 404, "Not found");
    const supplied = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1] ?? "";
    if (!equalSecret(supplied, token)) {
      response.setHeader("www-authenticate", "Bearer");
      return send(response, 401, "Unauthorized");
    }
    if (!["GET", "POST", "DELETE"].includes(request.method ?? "")) {
      response.setHeader("allow", "GET, POST, DELETE");
      return send(response, 405, "Method not allowed");
    }
    const body = request.method === "POST" ? await readBody(request) : undefined;
    const id = request.headers["mcp-session-id"];
    let session = typeof id === "string" ? sessions.get(id) : undefined;
    if (id !== undefined && !session) return send(response, 404, "Session not found");
    let created = false;
    if (!session) {
      if (request.method !== "POST" || !isInitializeRequest(body)) return send(response, 400, "Initialize a session first");
      if (resources.size >= MAX_SESSIONS) return send(response, 503, "Service unavailable");
      const server = createMcpServer(cfg);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: true,
        onsessioninitialized: (sessionId) => { sessions.set(sessionId, entry); },
      });
      const entry: Session = { server, transport, lastUsed: Date.now(), active: 0 };
      session = entry;
      resources.add(entry);
      created = true;
      try {
        await server.connect(transport);
      } catch (error) {
        await dispose(entry);
        throw error;
      }
      // connect installs its own onclose. Preserve SDK cleanup as well as ours.
      const onclose = transport.onclose;
      transport.onclose = () => {
        resources.delete(entry);
        if (transport.sessionId) sessions.delete(transport.sessionId);
        onclose?.();
      };
    }
    session.lastUsed = Date.now();
    const activeCall = request.method === "POST";
    if (activeCall) session.active++;
    try {
      await session.transport.handleRequest(request, response, body);
    } finally {
      if (activeCall) session.active--;
      session.lastUsed = Date.now();
      if (created && !session.transport.sessionId) await dispose(session);
    }
  };
  const listener = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      send(response, error instanceof RequestError ? error.status : 500,
        error instanceof RequestError ? error.message : "Internal server error");
    });
  });
  listener.requestTimeout = 30_000;
  listener.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(port, host, () => { listener.off("error", reject); resolve(); });
  });
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("HTTP listener did not bind a TCP port");
  const reaper = setInterval(() => {
    for (const session of resources) {
      if (session.active === 0 && Date.now() - session.lastUsed > SESSION_IDLE_MS) {
        void dispose(session).catch(() => undefined);
      }
    }
  }, 60_000);
  reaper.unref();
  let closePromise: Promise<void> | undefined;
  return {
    host: address.address,
    port: address.port,
    close() {
      closePromise ??= (async () => {
        closing = true;
        clearInterval(reaper);
        const stopped = new Promise<void>((resolve, reject) => {
          listener.close((error) => error ? reject(error) : resolve());
        });
        const deadline = setTimeout(() => listener.closeAllConnections(), 5_000);
        deadline.unref();
        try {
          await Promise.allSettled([...resources].map(dispose));
          listener.closeIdleConnections();
          await stopped;
        } finally {
          clearTimeout(deadline);
        }
      })();
      return closePromise;
    },
  };
}

export async function startHttpServer(): Promise<void> {
  const http = await createHttpServer();
  const host = http.host.includes(":") ? `[${http.host}]` : http.host;
  console.error(`proxmox-mcp HTTP listening on http://${host}:${http.port}/mcp`);
  const shutdown = () => {
    void http.close().then(() => {
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
    }).catch(() => { process.exitCode = 1; });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
