import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOL_TIERS, type ToolTier } from "../src/registry.ts";

// Keeps the frozen benchmark honest against the code: every ground-truth label
// must be a real registered tool, and every safety prompt's declared required_tier
// must match the tool's actual access tier. A relabeled or renamed tool that broke
// the benchmark would otherwise pass silently.

interface Prompt {
  id: string;
  category: "single-domain" | "cross-domain" | "safety-sensitive";
  domains: string[];
  prompt: string;
  expected_tools: string[];
  required_tier?: ToolTier;
}

interface Frozen {
  frozen: boolean;
  domains: string[];
  prompts: Prompt[];
}

const path = join(dirname(fileURLToPath(import.meta.url)), "..", "benchmarks", "dynamic-tools", "prompts.json");
const set = JSON.parse(readFileSync(path, "utf8")) as Frozen;

describe("dynamic-tools benchmark freeze", () => {
  it("has exactly 32 prompts with the frozen category split (16/8/8)", () => {
    const by = { "single-domain": 0, "cross-domain": 0, "safety-sensitive": 0 } as Record<string, number>;
    for (const p of set.prompts) by[p.category]++;
    expect(set.prompts.length).toBe(32);
    expect(by).toEqual({ "single-domain": 16, "cross-domain": 8, "safety-sensitive": 8 });
  });

  it("has unique prompt ids", () => {
    const ids = set.prompts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels only real registered tools", () => {
    const unknown: Array<{ id: string; tool: string }> = [];
    for (const p of set.prompts) {
      for (const t of p.expected_tools) {
        if (!(t in TOOL_TIERS)) unknown.push({ id: p.id, tool: t });
      }
    }
    expect(unknown).toEqual([]);
  });

  it("uses only declared domains", () => {
    const declared = new Set(set.domains);
    const bad: Array<{ id: string; domain: string }> = [];
    for (const p of set.prompts) {
      for (const d of p.domains) if (!declared.has(d)) bad.push({ id: p.id, domain: d });
    }
    expect(bad).toEqual([]);
  });

  it("safety prompts declare a required_tier that matches the tool's real access tier", () => {
    const mismatches: Array<{ id: string; tool: string; required: ToolTier; actual: ToolTier }> = [];
    for (const p of set.prompts.filter((x) => x.category === "safety-sensitive")) {
      expect(p.required_tier, `${p.id} missing required_tier`).toBeDefined();
      // safety prompts are authored single-tool; the label's tier must match the claim
      const tool = p.expected_tools[0];
      const actual = TOOL_TIERS[tool];
      if (p.required_tier !== actual) {
        mismatches.push({ id: p.id, tool, required: p.required_tier!, actual });
      }
    }
    expect(mismatches).toEqual([]);
  });
});
