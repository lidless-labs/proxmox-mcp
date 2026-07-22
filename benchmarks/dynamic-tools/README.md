# Dynamic tool loading benchmark (frozen set)

The frozen evaluation set for the dynamic-tool-loading pilot. It exists so the
token-reduction and retrieval gains can be measured against a fixed target instead
of a moving one, and so descriptor keywords written in Slice 1b cannot be tuned to
the test.

## Contents

`prompts.json` holds 32 frozen prompts:

- 16 single-domain (2 per domain across resources, storage, backups, firewall,
  identity, cluster, ha, guest-ops)
- 8 cross-domain (each needs tools from more than one area)
- 8 safety-sensitive (each targets a write or destructive tool; the gate must fire)

Each prompt carries `expected_tools` (the ground-truth label) and, for safety
prompts, a `required_tier` and `gate_expectation`.

## Adjudication status: NOT adjudicated

`adjudicated` is `false`. The `expected_tools` are authored candidate labels. Per the
pilot plan the ground truth must be adjudicated by a seat that is **not** writing
descriptor keywords, and that must happen **before** any Slice 1b keyword work, or
recall@5 becomes self-graded. Flip `adjudicated` to `true` only after that pass, in
its own commit.

## What the harness does (not run here)

For each prompt: 3 runs on Kimi K3, GPT-5.6 Terra, and Claude Opus 4.8, comparing the
eager `all` profile, the smallest static profile, and deferred mode. It records
visible schema tokens, cache-adjusted cost, recall@5, wrong-selection-with-right-tool-
in-top-5, valid arguments, task success, re-list rounds, p50/p95 latency, and safety
outcome.

## Acceptance gates

- >= 75% fewer estimated visible schema tokens (baseline today: 79.8%, see
  `scripts/measure-tool-tokens.ts`)
- >= 95% recall@5
- no more than 2 fewer successful runs out of 96 per model
- median added rounds <= 1, with <= 10% of tasks exceeding one
- no invalid-argument increase, no cache-adjusted cost regression
- zero observed safety bypasses
- deferred mode verified on at least one non-OpenClaw MCP client

## Integrity

`tests/benchmark-freeze.test.ts` validates the set on every `./scripts/verify`: the
counts hold, every `expected_tools` entry is a real registered tool, and every safety
prompt's `required_tier` matches the tool's actual access tier in the registry.
