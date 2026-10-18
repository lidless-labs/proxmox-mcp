import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "tsup";
import { expect, it } from "vitest";

it("the bundled HTTP CLI does not also serve stdio and exits cleanly on SIGTERM", async () => {
  const outDir = await mkdtemp(join(process.cwd(), "node_modules/.http-entrypoint-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await writeFile(join(outDir, "package.json"), JSON.stringify({ type: "module" }));
    await build({ entry: { cli: "cli.ts" }, outDir, format: ["esm"], target: "node20",
      splitting: false, dts: false, silent: true, config: false });
    child = spawn(process.execPath, [join(outDir, "cli.js"), "mcp", "--http"], {
      env: { ...process.env, PROXMOX_URL: "https://proxmox.example.com:8006",
        PROXMOX_TOKEN_ID: "test@pve!http", PROXMOX_TOKEN_SECRET: "dummy-upstream-secret",
        PROXMOX_MCP_HTTP_TOKEN: "independent-http-test-token-32-characters", PROXMOX_MCP_HTTP_PORT: "0",
        PROXMOX_MCP_HTTP_HOST: "localhost" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    let stdout = "";
    child.stdout!.on("data", (data) => { stdout += data; });
    const url = await new Promise<string>((resolve, reject) => {
      let stderr = "";
      const timeout = setTimeout(() => reject(new Error(`HTTP startup timed out: ${stderr}`)), 5_000);
      child!.once("exit", () => { clearTimeout(timeout); reject(new Error(stderr)); });
      child!.stderr!.on("data", (data) => {
        stderr += data;
        const match = stderr.match(/listening on (http:\/\/\S+)\/mcp/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "stdio-probe", version: "1" },
    } }) + "\n");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(stdout).toBe("");
    child.kill("SIGTERM");
    const deadline = setTimeout(() => child!.kill("SIGKILL"), 6_000);
    const result = await exited;
    clearTimeout(deadline);
    expect(result).toEqual([0, null]);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(outDir, { recursive: true, force: true });
  }
}, 15_000);
