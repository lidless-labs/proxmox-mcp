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

## Adjudication status: adjudicated (2026-07-22)

`adjudicated` is `true`. Four independent cross-model seats (gpt-5.6-sol,
gemini-3.6-flash, glm-cursor, claude-opus-4-8) labeled all 32 prompts from
`catalog.json` alone, blind to `expected_tools` (brigade run
`20260722-193221-77fd1c12`). 30 of 32 were unanimous with the authored candidates;
all 8 safety and all 8 cross-domain labels were unanimous. Two splits were resolved:

- **SD-STO-2** (list ISO images) was a 2-2 tie between `proxmox_list_storage_content`
  and `proxmox_list_templates`, both single-call correct. It carries
  `accept_alternatives` so either scores correct.
- **CD-2** (find node + show config) was a 3-1 split on step one; the majority backed
  the authored `proxmox_get_resource`, so it was kept unchanged.

Tier distribution across the 32 prompts: 14 read / 12 safe-write / 6 destructive.

See the `adjudication` block in `prompts.json` for provenance and the independence
caveat on the claude seat.

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

## Slice 1b retrieval result (2026-07-22)

`scripts/measure-recall.ts` runs the frozen prompts through `searchTools()` (server-side
lexical index: keywords authored blind to these prompts, then segment-max scoring with
IDF term weighting).

- **recall@5 (per-label mean): 93.8%** against a >= 95% gate.
- 28/32 prompts fully covered on a single combined query; 29/32 when each intent may be
  searched separately (the deferred flow allows per-sub-task search).
- All 16 single-domain and all 8 safety prompts pass. The residual misses are all
  cross-domain "generic parent vs specific sibling" cases: CD-2 (`get_resource` vs
  `get_vm_config` - the adjudication itself split 3-1 here), CD-3 (`run_backup` vs
  `list_backups`), CD-6 (`read_file` vs guest/network tools), CD-7 (`list_storage` vs
  `list_storage_content`).

The lexical baseline lands ~1 point short of the gate without tuning keywords to the
prompts (which would void the blind-authoring guarantee) or widening labels to fit the
retriever (which would tune the test to the system). Closing the gap is tracked as a
follow-up: either a targeted blind keyword-specificity pass or a stronger retriever
(embedding rerank over the lexical top-k).

## Integrity

`tests/benchmark-freeze.test.ts` validates the set on every `./scripts/verify`: the
counts hold, every `expected_tools` entry is a real registered tool, and every safety
prompt's `required_tier` matches the tool's actual access tier in the registry.
