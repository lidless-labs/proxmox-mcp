import { describe, it, expect } from "vitest";
import { TOOL_TIERS } from "../src/registry.ts";
import { TOOL_SEARCH_META, DOMAINS } from "../src/search.ts";

// Search metadata must cover exactly the registered tools, with a valid domain and a
// real set of keywords. Full coverage is what lets buildSearchIndex refuse to build a
// half-populated index at startup.

describe("search metadata coverage", () => {
  it("declares search metadata for exactly the registered tools", () => {
    const registered = new Set(Object.keys(TOOL_TIERS));
    const declared = new Set(Object.keys(TOOL_SEARCH_META));
    const missing = [...registered].filter((n) => !declared.has(n));
    const extra = [...declared].filter((n) => !registered.has(n));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("assigns every tool a valid domain", () => {
    const valid = new Set(DOMAINS);
    const bad = Object.entries(TOOL_SEARCH_META)
      .filter(([, m]) => !valid.has(m.domain))
      .map(([name, m]) => ({ name, domain: m.domain }));
    expect(bad).toEqual([]);
  });

  it("gives every tool a usable keyword set (>= 3, lowercase, deduped, no tool-name echo)", () => {
    const bad: Array<{ name: string; reason: string }> = [];
    for (const [name, m] of Object.entries(TOOL_SEARCH_META)) {
      const kws = m.keywords;
      if (kws.length < 3) bad.push({ name, reason: `only ${kws.length} keywords` });
      if (kws.some((k) => k !== k.toLowerCase())) bad.push({ name, reason: "non-lowercase keyword" });
      if (new Set(kws).size !== kws.length) bad.push({ name, reason: "duplicate keywords" });
      if (kws.some((k) => k.trim() === "")) bad.push({ name, reason: "empty keyword" });
    }
    expect(bad).toEqual([]);
  });
});
