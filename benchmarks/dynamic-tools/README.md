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

- >= 75% fewer estimated visible schema tokens (descriptor-level baseline 79.8% per
  `scripts/measure-tool-tokens.ts`; deferred mode measures 98.0%, 1,400 visible bytes
  against the 68,495-byte full catalog) - **CLEARED**
- >= 95% recall@5, single-query definition - **NOT MET at 93.8%, and ACCEPTED as the
  lexical baseline** (decision 2026-07-25). The gap is one half-prompt out of 32 and every
  available route to a green number recovers the same single prompt, so the metric is
  noise-dominated at this margin. The pilot proceeds on task success instead; see below.
- no more than 2 fewer successful runs out of 96 per model
- median **added network rounds** <= 1, with <= 10% of tasks exceeding one (see
  "Added rounds" below for why this is network rounds specifically)
- no invalid-argument increase, no cache-adjusted cost regression
- zero observed safety bypasses
- deferred mode verified on at least one non-OpenClaw MCP client - **CLEARED** on Claude
  Code 2.1.219 (re-lists 2ms after `notifications/tools/list_changed`, then calls the new
  typed tool). A second client has now been tested and **fails**: Cursor (cursor-agent
  2026.07.23) receives the notification and never re-lists, so the loaded tools stay
  unreachable. Codex CLI 0.145.0 could not dispatch MCP tool calls headlessly and is
  untested. `list_changed` support is therefore real but not portable, which is the
  justification for keeping deferred mode opt-in with static profiles as the default.

## Added rounds: network rounds vs model turns

The original gate said "median added rounds <= 1" without saying what a round is. The
client spike showed the two candidate readings give different answers on the same client,
so this is pinned **before** the end-to-end runs rather than after the numbers land.

Deferred mode costs, per task that needs a tool:

| Cost | What it is | Gated? |
| --- | --- | --- |
| `added_network_rounds` | The `tools/list` re-fetch the client makes after `list_changed`. Measured at 2ms on Claude Code. | **Yes, median <= 1** |
| `added_model_turns` | Extra model turns before the tool can be called. On a client that layers its own tool deferral, a newly listed tool is *visible but not immediately callable*: Claude Code spent one further turn selecting the schema. | Reported, not gated |

Both are recorded per run. The gate stays on network rounds because that is the cost the
protocol imposes and the one we control; model turns are a property of the client's own
deferral strategy, and we have data from exactly one client so far. Promoting
`added_model_turns` to a gate needs a second client's numbers first.

## Recall: two definitions, only one of them the gate

`scripts/measure-recall.ts` reports both. The exit code follows the first.

| Definition | What the agent does | recall@5 | Full coverage |
| --- | --- | --- | --- |
| **single-query (GATE)** | one combined search for the whole prompt | **93.8%** | 28/32 |
| per-intent (secondary) | one search per intent segment, union of results | 95.3% | 29/32 |

**Decision 2026-07-25: 93.8% single-query is accepted as the lexical baseline.** The gate is
recorded as not met rather than reworked into a pass. The end-to-end runs proceed and task
success is the number that decides the pilot; if retrieval misses turn out to cost task
success, that will show up there and justify a stronger retriever on evidence. An embedding
rerank stays unfunded until then, since it is the only remaining route and it adds a model
dependency to the request path.

Per-intent is arguably the more faithful model of the deployed system: the protocol permits
repeated searches and `proxmox_search_tools`' own description invites the agent to describe
the whole task. It still does not get promoted to the gate here, for a reason visible in the
numbers: **it flips FAIL to PASS by recovering exactly one prompt (CD-7), and the margin is
one half-prompt.** Each of the 32 prompts is worth 1/32 and each current miss costs half a
prompt, so any single recovered miss clears 95%. A gate decided by one label is not
measuring retrieval quality. Swapping the definition after seeing which one passes would be
goalpost-moving; if per-intent becomes the gate, that is a recorded decision made on its
merits, not a consequence of it being the number that passed.

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

### Approaches ruled out (2026-07-25)

Recorded so they are not retried from scratch.

- **Naive adjacent-token bigram expansion** ("back up" -> "backup"): dropped recall to
  89.1% through spurious joins (`upcontainer`, `backupjobs`).
- **Structural parent expansion by name prefix** (when a specific tool matches, admit the
  generic tool whose name is its prefix). This looked like the ideal fix, since 3 of the 4
  misses are generic-parent-vs-specific-sibling and a name-prefix rule reads only the
  registry, never the prompts. It dies on the corpus: across all 96 tools there are exactly
  **two** name-prefix pairs, both under `proxmox_list_storage`
  (`+_config`, `+_content`). The rule's entire footprint is the one parent tool that happens
  to be the CD-7 miss. Shipping it would clear the gate while being indistinguishable in
  effect from hand-fixing the failing prompt: overfitting in structural clothing. The
  general-sounding form of a rule is not evidence that it generalizes; check its footprint
  on the corpus first.
- Note that CD-2, CD-3 and CD-6 are *not* prefix relationships at all
  (`get_resource`/`get_vm_config`, `run_backup`/`list_backups`, `read_file`/guest tools).
  They are semantic generic-vs-specific pairs, which is why an embedding rerank over the
  lexical top-k remains the only candidate that could move them for reasons unrelated to
  CD-7. It needs a decision on adding a model dependency to the request path.

## Integrity

`tests/benchmark-freeze.test.ts` validates the set on every `./scripts/verify`: the
counts hold, every `expected_tools` entry is a real registered tool, and every safety
prompt's `required_tier` matches the tool's actual access tier in the registry.
