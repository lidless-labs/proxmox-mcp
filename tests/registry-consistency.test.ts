import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOL_TIERS, type ToolTier } from "../src/registry.ts";

// This test is the safety spine of the operation registry. TOOL_TIERS is
// descriptive metadata; the real enforcement is the gate the executor calls. If
// the two ever drift (a gate is removed but the tier stays "safe-write", or a
// tool is promoted to a destructive gate but still labeled "read"), MCP clients
// would show a wrong safety annotation. This test re-derives the tier straight
// from the executor source and fails on any mismatch.
//
// Gates can live in the tool file OR in a shared helper the tool delegates to
// (e.g. src/tools/service-action.ts), so the scan follows sibling imports
// transitively within src/tools/ before deciding the tier.

const toolsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "tools");

function readSourceGraph(entryFile: string): string {
  const seen = new Set<string>();
  let combined = "";
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    let src: string;
    try {
      src = readFileSync(join(toolsDir, file), "utf8");
    } catch {
      return; // import resolved outside src/tools (e.g. ../gates.ts handled below)
    }
    combined += "\n" + src;
    for (const m of src.matchAll(/from\s+"\.\/([a-z0-9_-]+)\.ts"/gi)) {
      visit(`${m[1]}.ts`);
    }
  };
  visit(entryFile);
  return combined;
}

function tierFromSource(entryFile: string): ToolTier {
  const src = readSourceGraph(entryFile);
  if (/\bassertDestructive\b/.test(src)) return "destructive";
  if (/\bassertConfirmedWrite\b/.test(src)) return "safe-write";
  return "read";
}

function toolNameOf(entryFile: string): string {
  const src = readFileSync(join(toolsDir, entryFile), "utf8");
  const m = src.match(/(?:name:|const NAME =)\s*"(proxmox_[a-z_]+)"/);
  return m?.[1] ?? entryFile.replace(/\.ts$/, "");
}

const toolFiles = readdirSync(toolsDir).filter(
  (f) => f.startsWith("proxmox_") && f.endsWith(".ts"),
);

describe("registry tier consistency", () => {
  it("declares a tier for exactly the registered tools (no missing, no extra)", () => {
    const fromSource = new Set(toolFiles.map(toolNameOf));
    const declared = new Set(Object.keys(TOOL_TIERS));
    const missing = [...fromSource].filter((n) => !declared.has(n));
    const extra = [...declared].filter((n) => !fromSource.has(n));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("every declared tier matches the gate the executor actually enforces", () => {
    const mismatches: Array<{ tool: string; declared: ToolTier; fromGate: ToolTier }> = [];
    for (const file of toolFiles) {
      const tool = toolNameOf(file);
      const declared = TOOL_TIERS[tool];
      const fromGate = tierFromSource(file);
      if (declared !== fromGate) mismatches.push({ tool, declared, fromGate });
    }
    expect(mismatches).toEqual([]);
  });

  it("keeps the expected tier distribution (43 read / 44 safe-write / 9 destructive)", () => {
    const counts = { read: 0, "safe-write": 0, destructive: 0 } as Record<ToolTier, number>;
    for (const tier of Object.values(TOOL_TIERS)) counts[tier]++;
    expect(counts).toEqual({ read: 43, "safe-write": 44, destructive: 9 });
  });
});
