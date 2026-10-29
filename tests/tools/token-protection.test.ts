import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm, chmod, symlink, readdir, readlink } from "node:fs/promises";
import { renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { startFakeProxmox, type FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxCreateTokenTool, createProxmoxSetAclTool } from "../../src/tools/index.ts";
import { redact } from "../../src/security.ts";

let fake: FakeProxmox;
let dir: string;
let value: string;
const args = { userid: "automation@pve", tokenid: "ci", confirm: true };
const client = () => new ProxmoxClient({ url: fake.baseUrl, tokenId: "fixture@pam!test", tokenSecret: "fixture-only", tlsInsecure: false });
beforeEach(async () => {
  value = randomUUID();
  dir = await mkdtemp(join(tmpdir(), "proxmox-consumer-test-"));
  fake = await startFakeProxmox([{ method: "POST", path: "/api2/json/access/users/automation%40pve/token/ci", status: 200, body: { data: { "full-tokenid": "automation@pve!ci", value } } }]);
  vi.stubEnv("PROXMOX_ENABLE_IDENTITY_PROVISIONING", "1");
  vi.stubEnv("PROXMOX_TOKEN_CONSUMER", join(dir, "consume"));
  await writeFile(join(dir, "consume"), `#!${process.execPath}\nconst fs = require('node:fs'); const crypto = require('node:crypto'); let data = ''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => { const p = JSON.parse(data); fs.writeFileSync(${JSON.stringify(join(dir, "digest"))}, crypto.createHash('sha256').update(p.secret).digest('hex'), { mode: 0o600 }); });\n`, { mode: 0o700 });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  try {
    // A leaked consumer handle survives both API failures and successful delivery.
    const targets = await Promise.all((await readdir("/proc/self/fd")).map(fd => readlink(`/proc/self/fd/${fd}`).catch(() => "")));
    expect(targets.filter(target => target.startsWith(`${dir}/`))).toEqual([]);
  } finally {
    await fake.close();
    await rm(dir, { recursive: true, force: true });
  }
});

describe("identity provisioning", () => {
  it.each(["token", "acl"])("denies %s provisioning by default before network", async (kind) => {
    vi.stubEnv("PROXMOX_ENABLE_IDENTITY_PROVISIONING", "");
    const tool = kind === "token" ? createProxmoxCreateTokenTool(client) : createProxmoxSetAclTool(client);
    await expect(tool.execute("test", kind === "token" ? args : { path: "/", userid: "automation@pve", roles: "Administrator", confirm: true })).rejects.toThrow(/PROXMOX_ENABLE_IDENTITY_PROVISIONING/);
    expect(fake.requests.length).toBe(0);
  });
  it("requires a protected consumer before creating a token", async () => {
    vi.stubEnv("PROXMOX_TOKEN_CONSUMER", "");
    await expect(createProxmoxCreateTokenTool(client).execute("test", args)).rejects.toThrow(/consumer/i);
    expect(fake.requests.length).toBe(0);
  });
  it("streams the new secret to the consumer and excludes it from model results", async () => {
    const result = await createProxmoxCreateTokenTool(client).execute("test", args);
    expect(JSON.stringify(result).includes(value)).toBe(false);
    expect(await readFile(join(dir, "digest"), "utf8")).toBe(createHash("sha256").update(value).digest("hex"));
    expect(redact(value) === "REDACTED").toBe(true);
    expect(fake.requests.length).toBe(1);
  });
  it.each(["file", "symlink"])("executes the validated consumer after %s substitution during token creation", async (kind) => {
    const consumerPath = join(dir, "consume");
    const replacement = join(dir, "replacement");
    await writeFile(replacement, `#!${process.execPath}\nconst fs = require('node:fs'); process.stdin.on('data', () => fs.writeFileSync(${JSON.stringify(join(dir, "intercepted"))}, 'received'));\n`, { mode: 0o700 });
    const swappingClient = () => {
      renameSync(consumerPath, join(dir, "validated"));
      if (kind === "symlink") symlinkSync(replacement, consumerPath);
      else renameSync(replacement, consumerPath);
      return client();
    };
    const result = await createProxmoxCreateTokenTool(swappingClient).execute("test", args);
    expect(JSON.stringify(result).includes(value)).toBe(false);
    await expect(readFile(join(dir, "intercepted"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(dir, "digest"), "utf8")).toBe(createHash("sha256").update(value).digest("hex"));
    expect(fake.requests.length).toBe(1);
  });
  it.each(["writable", "symlink", "non-executable"])("rejects a %s consumer before any API write", async (kind) => {
    if (kind === "symlink") {
      await symlink(join(dir, "consume"), join(dir, "link"));
      vi.stubEnv("PROXMOX_TOKEN_CONSUMER", join(dir, "link"));
    } else await chmod(join(dir, "consume"), kind === "writable" ? 0o722 : 0o600);
    await expect(createProxmoxCreateTokenTool(client).execute("test", args)).rejects.toThrow(/consumer/i);
    expect(fake.requests.length).toBe(0);
  });
  it("suppresses consumer diagnostics and never retries token creation on delivery failure", async () => {
    await writeFile(join(dir, "consume"), `#!${process.execPath}\nprocess.stdin.on('data', c => process.stderr.write(c)); process.stdin.on('end', () => process.exit(1));\n`, { mode: 0o700 });
    let error: unknown;
    try { await createProxmoxCreateTokenTool(client).execute("test", args); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(Error);
    expect(String(error).includes(value)).toBe(false);
    expect(String(error)).toMatch(/created.*delivery failed/i);
    expect(fake.requests.length).toBe(1);
  });
  it.each(["api-error", "missing-credential"])("closes the consumer on %s without retrying provisioning", async (kind) => {
    fake.routes[0].status = kind === "api-error" ? 500 : 200;
    fake.routes[0].body = { data: {} };
    await expect(createProxmoxCreateTokenTool(client).execute("test", args)).rejects.toThrow(kind === "api-error" ? /500/ : /Inspect token state/);
    expect(fake.requests.length).toBe(1);
    await expect(readFile(join(dir, "digest"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("closes the consumer when its shebang interpreter cannot start", async () => {
    await writeFile(join(dir, "consume"), "#!/nonexistent-proxmox-test-interpreter\n", { mode: 0o700 });
    await expect(createProxmoxCreateTokenTool(client).execute("test", args)).rejects.toThrow(/created.*delivery failed/i);
    expect(fake.requests.length).toBe(1);
  });
  it("times out credential delivery without reprovisioning or returning plaintext", async () => {
    await writeFile(join(dir, "consume"), `#!${process.execPath}\nprocess.stdin.resume(); setInterval(() => {}, 1000);\n`, { mode: 0o700 });
    let error: unknown;
    try { await createProxmoxCreateTokenTool(client).execute("test", args); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(Error);
    expect(String(error).includes(value)).toBe(false);
    expect(String(error)).toMatch(/created.*delivery failed/i);
    expect(fake.requests.length).toBe(1);
  }, 15_000);
});
