// Measures retrieval quality of the search index against the frozen, adjudicated
// benchmark: does searchTools() surface the ground-truth tool(s) in the top-5?
// This is the >=95% recall@5 acceptance gate. Run: npx tsx scripts/measure-recall.ts
//
// Keywords were authored blind to these prompts (see the benchmark adjudication), so a
// high number here is a real retrieval result, not the index memorizing the test.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildSearchIndex, searchTools, TOOL_SEARCH_META } from "../src/search.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const benchDir = join(root, "benchmarks", "dynamic-tools");

interface Prompt {
  id: string;
  prompt: string;
  expected_tools: string[];
  accept_alternatives?: string[][];
}

const catalog = JSON.parse(readFileSync(join(benchDir, "catalog.json"), "utf8")) as Array<{ name: string; description: string }>;
const prompts = (JSON.parse(readFileSync(join(benchDir, "prompts.json"), "utf8")).prompts) as Prompt[];

const index = buildSearchIndex(catalog, TOOL_SEARCH_META);
const TOP_K = 5;
const GATE = 0.95;

// Acceptable sets for a prompt: its expected_tools plus any accept_alternatives sets.
// A prompt's recall is the best (max) fraction of any one acceptable set found in top-K.
function acceptableSets(p: Prompt): string[][] {
  return [p.expected_tools, ...(p.accept_alternatives ?? [])];
}

let sumRecall = 0;
let exactPass = 0;
const misses: Array<{ id: string; missing: string[]; top5: string[] }> = [];

for (const p of prompts) {
  const top = searchTools(p.prompt, index, { limit: TOP_K }).map((h) => h.name);
  const perSet = acceptableSets(p).map((set) => ({
    set,
    found: set.filter((t) => top.includes(t)),
  }));
  const best = perSet.reduce((a, b) => (b.found.length / b.set.length > a.found.length / a.set.length ? b : a));
  const recall = best.found.length / best.set.length;
  sumRecall += recall;
  if (recall === 1) exactPass++;
  else misses.push({ id: p.id, missing: best.set.filter((t) => !top.includes(t)), top5: top });
}

const perLabelRecall = sumRecall / prompts.length;
const perPromptPass = exactPass / prompts.length;

console.log(`prompts:              ${prompts.length}`);
console.log(`recall@${TOP_K} (mean):       ${(perLabelRecall * 100).toFixed(1)}%  (gate >= ${GATE * 100}%)`);
console.log(`prompts fully covered: ${exactPass}/${prompts.length}  (${(perPromptPass * 100).toFixed(1)}%)`);
console.log(`gate:                 ${perLabelRecall >= GATE ? "PASS" : "FAIL"}`);
if (misses.length > 0) {
  console.log(`\nmisses (expected tool not in top ${TOP_K}):`);
  for (const m of misses) console.log(`  ${m.id}: missing ${m.missing.join(", ")}  | top5: ${m.top5.join(", ")}`);
}

if (perLabelRecall < GATE) process.exit(1);
