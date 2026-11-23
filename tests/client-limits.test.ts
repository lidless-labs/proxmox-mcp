import { afterEach, describe, expect, it } from "vitest";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import type { ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyToolError } from "../src/errors.ts";
import { ProxmoxClient, ProxmoxClientError, ProxmoxWriteOutcomeUnknownError } from "../src/proxmox-client.ts";

const fixtureDir = mkdtempSync(join(tmpdir(), "proxmox-tls-test-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(fixtureDir, "key"), "-out", join(fixtureDir, "cert"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
const tls = { key: readFileSync(join(fixtureDir, "key")), cert: readFileSync(join(fixtureDir, "cert")) };
rmSync(fixtureDir, { recursive: true });
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function fixture(secure: boolean, respond: (res: ServerResponse) => void, requestTimeoutMs = 1_000) {
  let requests = 0;
  const handler = (_req: unknown, res: ServerResponse) => { requests++; respond(res); };
  const server = secure ? httpsServer(tls, handler) : httpServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address() as { port: number };
  const client = new ProxmoxClient({ url: `${secure ? "https" : "http"}://127.0.0.1:${address.port}`, tokenId: "fixture@pve!test", tokenSecret: "fixture-only", tlsInsecure: secure }, { retryDelayMs: 0, requestTimeoutMs, maxResponseBytes: 128 });
  return { client, requests: () => requests };
}

for (const secure of [false, true]) describe(secure ? "httpsRequest bounds" : "fetch bounds", () => {
  it.each([200, 401, 503])("rejects oversized streamed response with status %i", async (status) => {
    const { client } = await fixture(secure, (res) => { res.writeHead(status); res.write("x".repeat(129)); res.end(); });
    await expect(client.get("/version")).rejects.toThrow(/response exceeded/i);
  });

  it.each([
    { status: 200, body: '{"data":{"value":"unregistered-fixture-secret"' },
    { status: 200, body: '{"value":"unregistered-fixture-secret"}' },
    { status: 200, body: "" },
    { status: 200, body: "x".repeat(129) },
    ...[502, 503, 504].map((status) => ({ status, body: "unregistered-fixture-secret" })),
  ])("reports an unknown write outcome for HTTP $status with body '$body'", async ({ status, body }) => {
    const { client, requests } = await fixture(secure, (res) => {
      res.writeHead(status);
      res.write(body);
      res.end();
    });
    const error = await client.post("/mutation", {}).catch((error: unknown) => error);
    expect(requests()).toBe(1);
    expect(classifyToolError(error)).toMatchObject({
      code: "PROXMOX_WRITE_OUTCOME_UNKNOWN",
      error: expect.stringMatching(/may already have been applied.*proxmox_recent_tasks.*before retrying/i),
    });
    expect(error).toBeInstanceOf(ProxmoxWriteOutcomeUnknownError);
    expect(String(error)).not.toContain("unregistered-fixture-secret");
  });

  it.each([
    { body: '{"message":"permission denied for fixture-only"}', message: "permission denied" },
    { body: "x".repeat(129), message: "response exceeded" },
  ])("preserves the HTTP status on explicit write rejection ($message)", async ({ body, message }) => {
    const { client, requests } = await fixture(secure, (res) => {
      res.writeHead(403);
      res.write(body);
      res.end();
    });
    const error = await client.put("/mutation", {}).catch((error: unknown) => error);
    expect(requests()).toBe(1);
    expect(error).toBeInstanceOf(ProxmoxClientError);
    const payload = classifyToolError(error);
    expect(payload).toMatchObject({ code: "PROXMOX_HTTP_403", status: 403 });
    expect(payload.error).toContain(message);
    expect(payload.error).not.toContain("fixture-only");
  });

  it("keeps the deadline active after response headers and does not replay a write", async () => {
    const { client, requests } = await fixture(secure, (res) => {
      res.writeHead(200); res.flushHeaders(); res.write('{"data":');
      const timer = setTimeout(() => res.end('null}'), 250);
      res.on("close", () => clearTimeout(timer));
    }, 50);
    const error = await client.post("/mutation", {}).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ProxmoxWriteOutcomeUnknownError);
    expect(String(error)).toMatch(/timed out/i);
    expect(requests()).toBe(1);
  });

  it("rejects truncated upstream bodies", async () => {
    const { client } = await fixture(secure, (res) => {
      res.writeHead(200); res.write('{"data":'); setImmediate(() => res.destroy());
    });
    await expect(client.get("/version")).rejects.toThrow();
  });

  it("refuses upstream redirects", async () => {
    const { client, requests } = await fixture(secure, (res) => { res.writeHead(302, { location: "/api2/json/redirected" }); res.end(); });
    await expect(client.post("/mutation", {})).rejects.toMatchObject({ status: 302 });
    expect(requests()).toBe(1);
  });
});
