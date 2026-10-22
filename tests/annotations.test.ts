import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  DESTRUCTIVE_HINT_TOOLS,
  IDEMPOTENT_HINT_TOOLS,
  OPEN_WORLD_HINT_TOOLS,
  READ_ONLY_HINT_TOOLS,
  TOOL_TIERS,
  annotationsForTool,
} from "../src/registry.ts";
import { createMcpServer } from "../src/server.ts";

const MUST_BE_DESTRUCTIVE = /delete|destroy|exec|reset|stop|write|acl/;

describe("tool annotations", () => {
  it("flags command execution, file writes, stops and credential or permission changes as destructive", () => {
    for (const name of [
      "proxmox_exec",
      "proxmox_write_file",
      "proxmox_stop_resource",
      "proxmox_reset_resource",
      "proxmox_reboot_resource",
      "proxmox_service_stop",
      "proxmox_delete_pool",
      "proxmox_delete_token",
      "proxmox_create_token",
      "proxmox_delete_backup_job",
      "proxmox_delete_firewall_rule",
      "proxmox_delete_ha_resource",
      "proxmox_delete_replication",
      "proxmox_set_acl",
      "proxmox_set_firewall_enabled",
      "proxmox_resize_disk",
      "proxmox_move_disk",
      "proxmox_migrate_resource",
      "proxmox_download_url",
    ]) {
      expect(annotationsForTool(name), name).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
  });

  it("reports confirm-gated guest reads as read-only", () => {
    for (const name of ["proxmox_read_file", "proxmox_stat_path", "proxmox_service_status", "proxmox_list_directory"]) {
      expect(annotationsForTool(name), name).toEqual({ readOnlyHint: true, openWorldHint: false });
    }
  });

  it("keeps additive writes non-destructive", () => {
    for (const name of ["proxmox_start_resource", "proxmox_snapshot_resource", "proxmox_create_vm", "proxmox_add_firewall_rule"]) {
      expect(annotationsForTool(name).destructiveHint, name).toBe(false);
    }
  });

  it("marks download_url open-world and idempotent stop/start calls idempotent", () => {
    expect(annotationsForTool("proxmox_download_url").openWorldHint).toBe(true);
    expect(annotationsForTool("proxmox_stop_resource").idempotentHint).toBe(true);
    expect(annotationsForTool("proxmox_start_resource").idempotentHint).toBe(true);
    expect(annotationsForTool("proxmox_create_vm").idempotentHint).toBeUndefined();
  });

  it("declares destructiveHint for every state-changing tool whose name implies harm", () => {
    const missing = Object.keys(TOOL_TIERS)
      .filter((name) => MUST_BE_DESTRUCTIVE.test(name))
      .filter((name) => annotationsForTool(name).readOnlyHint !== true)
      .filter((name) => annotationsForTool(name).destructiveHint !== true);
    expect(missing).toEqual([]);
  });

  it("never reports a destructive tool as read-only", () => {
    for (const name of Object.keys(TOOL_TIERS)) {
      const a = annotationsForTool(name);
      expect(a.readOnlyHint === true && a.destructiveHint === true, name).toBe(false);
    }
  });

  it("states openWorldHint for every tool, true only for download_url and exec", () => {
    for (const name of Object.keys(TOOL_TIERS)) {
      expect(annotationsForTool(name).openWorldHint, name).toBe(
        name === "proxmox_download_url" || name === "proxmox_exec",
      );
    }
  });

  it("only names registered tools in the hint sets", () => {
    for (const set of [DESTRUCTIVE_HINT_TOOLS, READ_ONLY_HINT_TOOLS, IDEMPOTENT_HINT_TOOLS, OPEN_WORLD_HINT_TOOLS]) {
      for (const name of set) expect(TOOL_TIERS[name], name).toBeDefined();
    }
  });

  it("only downgrades a tier to read-only for confirm-gated guest reads", () => {
    for (const name of READ_ONLY_HINT_TOOLS) expect(TOOL_TIERS[name]).toBe("safe-write");
    for (const name of DESTRUCTIVE_HINT_TOOLS) expect(TOOL_TIERS[name]).not.toBe("read");
  });

  it("serves the annotations through tools/list", async () => {
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
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((t) => [t.name, t.annotations]));
      expect(byName.get("proxmox_exec")?.destructiveHint).toBe(true);
      expect(byName.get("proxmox_write_file")?.destructiveHint).toBe(true);
      expect(byName.get("proxmox_delete_token")?.destructiveHint).toBe(true);
      expect(byName.get("proxmox_read_file")?.readOnlyHint).toBe(true);
      expect(byName.get("proxmox_download_url")?.openWorldHint).toBe(true);
      expect(byName.get("proxmox_status")).toEqual({ readOnlyHint: true, openWorldHint: false });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
