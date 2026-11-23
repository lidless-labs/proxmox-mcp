// Run after the Node 22 build, using Node 20. Never loads the development tree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const proxmox = manifest.name.includes("proxmox");
const temp = mkdtempSync(join(tmpdir(), "standalone-smoke-"));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 120_000, ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
try {
  const [pack] = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp]));
  writeFileSync(join(temp, "package.json"), JSON.stringify({ private: true, type: "module" }));
  // An independent consumer install: no dev dependencies, optional peer, or lifecycle scripts.
  run("npm", ["install", "--omit=dev", "--omit=peer", "--ignore-scripts", "--engine-strict",
    "--no-audit", "--no-fund", join(temp, pack.filename)], { cwd: temp });
  const packageDir = join(temp, "node_modules", manifest.name);
  assert(!existsSync(join(temp, "node_modules/openclaw")), "OpenClaw must not be installed");
  const require = createRequire(join(packageDir, "package.json"));
  assert.throws(() => require.resolve("openclaw"), { code: "MODULE_NOT_FOUND" });
  const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")));
  const { StdioClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")));
  // Runtime processes get only synthetic config and fail on any attempted network access.
  const guard = join(temp, "no-network.cjs");
  const attempts = join(temp, "network-attempts");
  writeFileSync(guard, `const deny = () => {
    require('node:fs').appendFileSync(${JSON.stringify(attempts)}, 'attempt\\n');
    throw new Error('Network forbidden in standalone smoke');
  };
  globalThis.fetch = deny;
  for (const [module, methods] of Object.entries({http:['request','get'],https:['request','get'],net:['connect','createConnection'],tls:['connect']})) {
    for (const method of methods) require('node:' + module)[method] = deny;
  }`);
  const env = {
    PATH: process.env.PATH, HOME: temp, NODE_OPTIONS: `--require=${guard}`,
    ...(proxmox ? {
      PROXMOX_URL: "https://127.0.0.1:1", PROXMOX_TOKEN_ID: "smoke@pve!smoke",
      PROXMOX_TOKEN_SECRET: "synthetic-smoke-value",
    } : { N8N_BASE_URL: "http://127.0.0.1:1", N8N_API_KEY: "synthetic-smoke-value" }),
  };
  for (const [name, entry] of Object.entries(manifest.bin)) {
    const bin = resolve(packageDir, entry);
    if (entry.endsWith("cli.js")) {
      assert.equal(run(process.execPath, [bin, "--version"], { cwd: temp, env }).trim(), manifest.version);
      assert.match(run(process.execPath, [bin, "--help"], { cwd: temp, env }), /Usage:/);
    }
    const transport = new StdioClientTransport({
      command: process.execPath, args: entry.endsWith("cli.js") ? [bin, "mcp"] : [bin],
      cwd: temp, env, stderr: "pipe",
    });
    const client = new Client({ name: "standalone-smoke", version: "1.0.0" });
    let stderr = "";
    transport.stderr?.on("data", chunk => { stderr += chunk; });
    try {
      await client.connect(transport, { timeout: 10_000 });
      const { tools } = await client.listTools({}, { timeout: 10_000 });
      assert.equal(tools.length, proxmox ? 96 : 20, `${name}: unexpected default tool set`);
      assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
      console.log(`${name}: MCP initialized, ${tools.length} tools`);
    } catch (error) {
      throw new Error(`${name}: ${stderr}`, { cause: error });
    } finally {
      await client.close();
    }
  }
  assert(!existsSync(attempts), "Runtime attempted network access");
  console.log(`${manifest.name}: ${process.version}, packed production install, no OpenClaw, no network calls`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
