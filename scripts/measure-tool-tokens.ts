// Measures the schema-token footprint of the tool catalog so the dynamic-tool-
// loading token-reduction gate (>=75% fewer visible schema tokens) is a number on
// every run, not a promise. Run: npx tsx scripts/measure-tool-tokens.ts
//
// It instantiates every registered factory with stub dependencies (factories build
// their descriptor without touching the client, so stubs are safe), then compares
// the eager payload MCP sends today against a name+summary discovery descriptor.

import * as toolFactories from "../src/tools/index.ts";

const SUMMARY_CHARS = 100;
const BYTES_PER_TOKEN = 4; // rough GPT-style estimate; absolute value is indicative, the ratio is the gate

const stub: any = () => ({});
const vmDefaults: any = {};

interface Descriptor {
  name: string;
  description: string;
  parameters: unknown;
}

const descriptors: Descriptor[] = Object.entries(toolFactories)
  .filter(([k, v]) => k.startsWith("create") && typeof v === "function")
  .map(([, factory]) => (factory as (...a: unknown[]) => Descriptor)(stub, stub, vmDefaults));

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

// Eager: exactly what tools/list ships today per tool.
const fullBytes = descriptors.reduce(
  (sum, d) => sum + bytes({ name: d.name, description: d.description, inputSchema: d.parameters }),
  0,
);

// Discovery: name + truncated summary, schema loaded on demand.
const summaryBytes = descriptors.reduce(
  (sum, d) => sum + bytes({ name: d.name, summary: d.description.slice(0, SUMMARY_CHARS) }),
  0,
);

const reduction = 1 - summaryBytes / fullBytes;
const GATE = 0.75;

const fmt = (b: number) => `${b.toLocaleString()} bytes / ~${Math.round(b / BYTES_PER_TOKEN / 100) / 10}k tokens`;

console.log(`tools measured:        ${descriptors.length}`);
console.log(`eager catalog:         ${fmt(fullBytes)}`);
console.log(`name+summary catalog:  ${fmt(summaryBytes)}`);
console.log(`descriptor reduction:  ${(reduction * 100).toFixed(1)}%  (gate >= ${GATE * 100}%)`);
console.log(`gate:                  ${reduction >= GATE ? "PASS" : "FAIL"}`);

if (reduction < GATE) process.exit(1);
