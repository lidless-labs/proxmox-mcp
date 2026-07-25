// Measures retrieval quality of the search index against the frozen, adjudicated
// benchmark: does searchTools() surface the ground-truth tool(s) in the top-5?
// This is the >=95% recall@5 acceptance gate. Run: npx tsx scripts/measure-recall.ts
//
// Keywords were authored blind to these prompts (see the benchmark adjudication), so a
// high number here is a real retrieval result, not the index memorizing the test.
//
// TWO numbers are reported, and only the first is the gate:
//
//   1. single-query  - one combined search per prompt. This is the frozen gate metric.
//   2. per-intent    - one search per intent segment, union of the results. This is what
//                      the deferred protocol actually permits (and what the search tool's
//                      own description invites), so it is the more faithful model of the
//                      deployed system. Reported as SECONDARY and gates nothing, because
//                      swapping the gate metric after seeing the numbers would be
//                      goalpost-moving. Promoting it is a deliberate, recorded decision.
//
// The exit code follows the frozen single-query gate only.

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

// A prompt's recall against a candidate set the agent can see.
function recallFor(p: Prompt, seen: string[]): { recall: number; missing: string[] } {
  const perSet = acceptableSets(p).map((set) => ({ set, found: set.filter((t) => seen.includes(t)) }));
  const best = perSet.reduce((a, b) =>
    b.found.length / b.set.length > a.found.length / a.set.length ? b : a,
  );
  return {
    recall: best.found.length / best.set.length,
    missing: best.set.filter((t) => !seen.includes(t)),
  };
}

// Mirrors splitIntents() in src/search.ts: the connectives that separate intents.
function intentSegments(query: string): string[] {
  const parts = query
    .split(/\b(?:then|and)\b|[,;]+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [query];
}

let sumSingle = 0;
let sumPerIntent = 0;
let exactPass = 0;
let exactPassPerIntent = 0;
const misses: Array<{ id: string; missing: string[]; top5: string[]; perIntentFixes: boolean }> = [];

for (const p of prompts) {
  const top = searchTools(p.prompt, index, { limit: TOP_K }).map((h) => h.name);
  const single = recallFor(p, top);
  sumSingle += single.recall;
  if (single.recall === 1) exactPass++;

  // One search per intent, TOP_K results each, union of what the agent would have seen.
  const segments = intentSegments(p.prompt);
  const union = [
    ...new Set(segments.flatMap((s) => searchTools(s, index, { limit: TOP_K }).map((h) => h.name))),
  ];
  const perIntent = recallFor(p, union);
  sumPerIntent += perIntent.recall;
  if (perIntent.recall === 1) exactPassPerIntent++;

  if (single.recall < 1) {
    misses.push({
      id: p.id,
      missing: single.missing,
      top5: top,
      perIntentFixes: perIntent.recall > single.recall,
    });
  }
}

const n = prompts.length;
const perLabelRecall = sumSingle / n;
const perIntentRecall = sumPerIntent / n;

console.log(`prompts:                    ${n}`);
console.log(
  `recall@${TOP_K} single-query (GATE): ${(perLabelRecall * 100).toFixed(1)}%  (gate >= ${GATE * 100}%)  ${perLabelRecall >= GATE ? "PASS" : "FAIL"}`,
);
console.log(`  prompts fully covered:    ${exactPass}/${n}  (${((exactPass / n) * 100).toFixed(1)}%)`);
console.log(
  `recall@${TOP_K} per-intent (secondary, gates nothing): ${(perIntentRecall * 100).toFixed(1)}%`,
);
console.log(`  prompts fully covered:    ${exactPassPerIntent}/${n}  (${((exactPassPerIntent / n) * 100).toFixed(1)}%)`);

if (misses.length > 0) {
  console.log(`\nmisses under the gate metric (expected tool not in top ${TOP_K}):`);
  for (const m of misses) {
    console.log(
      `  ${m.id}: missing ${m.missing.join(", ")}${m.perIntentFixes ? "  [per-intent search recovers this]" : ""}`,
    );
    console.log(`      top${TOP_K}: ${m.top5.join(", ")}`);
  }
}

// Each prompt is worth 1/32, and every current miss costs half a prompt, so the gate is
// decided by very few labels. State that rather than letting a single prompt flip a PASS.
const promptsToGate = Math.ceil((GATE - perLabelRecall) * n * 2);
if (perLabelRecall < GATE) {
  console.log(
    `\nmargin: ${promptsToGate} half-prompt(s) short of the gate. Fixing any ${promptsToGate} of the ${misses.length} misses clears it,`,
  );
  console.log(
    "        which is exactly why a fix must be general and prompt-blind rather than aimed at one miss.",
  );
}

if (perLabelRecall < GATE) process.exit(1);
