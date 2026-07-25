// Slice 2: deferred tool loading. These tests pin the three invariants documented in
// src/deferred.ts, the third of which is safety-critical: a destructive tool reached
// through search must still face the full gate chain.

import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createDeferredSession,
  deferredModeEnabled,
  runToolSearch,
  SEARCH_TOOL_NAME,
  searchToolParameters,
} from "../src/deferred.ts";
import { buildSearchIndex, TOOL_SEARCH_META } from "../src/search.ts";
import { TOOL_TIERS } from "../src/registry.ts";
import { ToolInputError } from "../src/tools/_util.ts";
import { WriteGateError } from "../src/gates.ts";
import { startFakeProxmox, FakeProxmox } from "./fake-proxmox.ts";
import { ProxmoxClient } from "../src/proxmox-client.ts";
import { createProxmoxDestroyResourceTool } from "../src/tools/proxmox_destroy_resource.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  readFileSync(join(root, "benchmarks", "dynamic-tools", "catalog.json"), "utf8"),
) as Array<{ name: string; description: string }>;
const index = buildSearchIndex(catalog, TOOL_SEARCH_META);

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
  vi.unstubAllEnvs();
});

describe("deferred mode is opt-in", () => {
  it("is off when the env flag is absent or falsy", () => {
    expect(deferredModeEnabled({})).toBe(false);
    expect(deferredModeEnabled({ PROXMOX_DEFERRED_TOOLS: "" })).toBe(false);
    expect(deferredModeEnabled({ PROXMOX_DEFERRED_TOOLS: "0" })).toBe(false);
    expect(deferredModeEnabled({ PROXMOX_DEFERRED_TOOLS: "false" })).toBe(false);
    expect(deferredModeEnabled({ PROXMOX_DEFERRED_TOOLS: "off" })).toBe(false);
  });

  it("is on for the same truthy spellings the rest of the config accepts", () => {
    for (const v of ["1", "true", "TRUE", "yes", "Yes"]) {
      expect(deferredModeEnabled({ PROXMOX_DEFERRED_TOOLS: v })).toBe(true);
    }
  });
});

describe("connection-scoped session", () => {
  it("reports only newly added tools, so a repeat search cannot trigger a re-list", () => {
    const session = createDeferredSession();
    expect(session.load(["proxmox_status", "proxmox_list_vms"])).toEqual([
      "proxmox_status",
      "proxmox_list_vms",
    ]);
    expect(session.load(["proxmox_status"])).toEqual([]);
    expect(session.load(["proxmox_status", "proxmox_list_pools"])).toEqual(["proxmox_list_pools"]);
    expect(session.isLoaded("proxmox_status")).toBe(true);
    expect(session.isLoaded("proxmox_destroy_resource")).toBe(false);
    expect(session.loadedTools()).toHaveLength(3);
  });

  it("does not share loaded tools between sessions", () => {
    const a = createDeferredSession();
    const b = createDeferredSession();
    a.load(["proxmox_status"]);
    expect(b.isLoaded("proxmox_status")).toBe(false);
    expect(b.loadedTools()).toEqual([]);
  });
});

describe("search returns descriptors only", () => {
  it("loads the tools it returns and reports them as added", () => {
    const session = createDeferredSession();
    const out = runToolSearch({ query: "list my containers" }, index, session);
    expect(out.hits.length).toBeGreaterThan(0);
    expect(out.added).toEqual(out.hits.map((h) => h.name));
    for (const h of out.hits) expect(session.isLoaded(h.name)).toBe(true);
  });

  it("never puts server-side keywords in the payload", () => {
    const session = createDeferredSession();
    const out = runToolSearch({ query: "snapshot a container" }, index, session);
    for (const hit of out.hits) {
      expect(Object.keys(hit).sort()).toEqual([
        "description",
        "domain",
        "name",
        "requires",
        "tier",
      ]);
    }
    // The whole serialized result, not just the hits, must be keyword-free: the ~5pt
    // token margin over the 75% gate depends on it.
    const text = out.result.content[0].text;
    expect(text).not.toContain("keywords");
  });

  it("returns no added names on a repeated identical search", () => {
    const session = createDeferredSession();
    const first = runToolSearch({ query: "resize a disk" }, index, session);
    expect(first.added.length).toBeGreaterThan(0);
    const second = runToolSearch({ query: "resize a disk" }, index, session);
    expect(second.added).toEqual([]);
    expect(second.hits.map((h) => h.name)).toEqual(first.hits.map((h) => h.name));
  });

  it("honors the limit and the domain filter", () => {
    const session = createDeferredSession();
    const out = runToolSearch({ query: "backup", limit: 3 }, index, session);
    expect(out.hits.length).toBeLessThanOrEqual(3);

    const scoped = runToolSearch(
      { query: "list", domain: "identity", limit: 25 },
      index,
      createDeferredSession(),
    );
    expect(scoped.hits.length).toBeGreaterThan(0);
    for (const h of scoped.hits) expect(h.domain).toBe("identity");
  });

  it("rejects an empty query and an unknown domain", () => {
    const session = createDeferredSession();
    expect(() => runToolSearch({}, index, session)).toThrow(ToolInputError);
    expect(() => runToolSearch({ query: "   " }, index, session)).toThrow(ToolInputError);
    expect(() => runToolSearch({ query: "vms", domain: "nonsense" }, index, session)).toThrow(
      ToolInputError,
    );
    expect(session.loadedTools()).toEqual([]);
  });

  it("declares the search tool's own schema closed", () => {
    expect(searchToolParameters.additionalProperties).toBe(false);
    expect(Object.keys(searchToolParameters.properties).sort()).toEqual([
      "domain",
      "limit",
      "query",
    ]);
    expect(SEARCH_TOOL_NAME).not.toMatch(/^proxmox_(get|list|create|delete|destroy)/);
  });
});

describe("gates survive deferred loading", () => {
  it("surfaces destructive tools with their tier and required gate arguments", () => {
    const session = createDeferredSession();
    const out = runToolSearch({ query: "destroy a guest permanently", limit: 25 }, index, session);
    const hit = out.hits.find((h) => h.name === "proxmox_destroy_resource");
    expect(hit).toBeDefined();
    expect(hit!.tier).toBe("destructive");
    expect(hit!.requires).toEqual({
      confirm: true,
      destructive: true,
      env: "PROXMOX_ENABLE_DESTRUCTIVE=1",
    });
  });

  it("labels every hit with the tier the registry declares", () => {
    const out = runToolSearch({ query: "delete", limit: 25 }, index, createDeferredSession());
    expect(out.hits.length).toBeGreaterThan(0);
    for (const h of out.hits) expect(h.tier).toBe(TOOL_TIERS[h.name]);
  });

  it("never labels a gated tool as needing nothing", () => {
    const out = runToolSearch({ query: "snapshot rollback delete", limit: 25 }, index, createDeferredSession());
    for (const h of out.hits) {
      if (h.tier === "read") expect(h.requires).toBeNull();
      else expect(h.requires).not.toBeNull();
    }
  });

  // The invariant that makes deferred mode safe to ship: reaching a destructive tool
  // through search grants nothing. The full chain still fires before any HTTP request.
  it("still requires the full gate chain on a destructive tool obtained via search", async () => {
    fake = await startFakeProxmox([]);
    const session = createDeferredSession();
    const out = runToolSearch({ query: "destroy a guest permanently", limit: 25 }, index, session);
    expect(out.hits.some((h) => h.name === "proxmox_destroy_resource")).toBe(true);
    expect(session.isLoaded("proxmox_destroy_resource")).toBe(true);

    const tool = createProxmoxDestroyResourceTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );

    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "");
    await expect(tool.execute("test", { vmid: 110, confirm: true, destructive: true })).rejects.toThrow(
      /PROXMOX_ENABLE_DESTRUCTIVE/,
    );

    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "1");
    await expect(tool.execute("test", { vmid: 110, confirm: true })).rejects.toThrow(WriteGateError);
    await expect(tool.execute("test", { vmid: 110, destructive: true })).rejects.toThrow(
      WriteGateError,
    );

    // Nothing above should have reached the network.
    expect(fake.requests).toHaveLength(0);
  });
});
