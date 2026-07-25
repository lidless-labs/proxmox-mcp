// Deferred tool loading (Slice 2 of the dynamic-tool-loading pilot).
//
// At connect time a deferred-mode session exposes ONE tool, `proxmox_search_tools`.
// Calling it returns candidate descriptors and adds those tools to this connection's
// visible set; the server then emits `notifications/tools/list_changed` and the client
// re-fetches `tools/list` and calls the chosen tool directly, with its real schema.
//
// Verified against a live client before this was written: Claude Code 2.1.219 re-lists
// 2ms after the notification and calls the newly listed tool. Clients that do not honor
// list_changed keep using the static full tool set, which stays the default.
//
// THREE INVARIANTS, all of which the tests pin:
//
//  1. Opt-in. Without PROXMOX_DEFERRED_TOOLS the server behaves exactly as before:
//     all tools visible, no search tool, no list_changed capability advertised.
//
//  2. Visibility is NOT a security boundary; the gates are. Hiding a tool saves
//     tokens, nothing else. So destructive tools ARE searchable, and a direct call to
//     a registered-but-not-yet-loaded tool is honored rather than refused. Refusing
//     would invent a second, weaker enforcement surface that could fail closed on a
//     legitimate call while adding no safety: every gate in gates.ts fires on the
//     executor path either way. `tests/deferred.test.ts` proves a destructive tool
//     reached through search still needs confirm + destructive + the env flag.
//
//  3. Search returns descriptors, never a generic execute-by-name, and never the
//     server-side keywords. Keywords stay out of the payload because the measured
//     token margin over the 75% gate is only ~5 points.

import { Type } from "@sinclair/typebox";
import { DOMAINS, type Domain, type SearchRecord, searchTools } from "./search.ts";
import { TOOL_TIERS, type ToolTier } from "./registry.ts";
import { jsonToolResult, ToolInputError } from "./tools/_util.ts";

export const SEARCH_TOOL_NAME = "proxmox_search_tools";
export const DEFERRED_ENV_FLAG = "PROXMOX_DEFERRED_TOOLS";

const TRUTHY = ["true", "1", "yes"];

export function deferredModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env[DEFERRED_ENV_FLAG];
  return typeof value === "string" && TRUTHY.includes(value.toLowerCase());
}

export const SEARCH_TOOL_DESCRIPTION =
  "Find Proxmox tools by describing the task in plain language, then call the tool this " +
  "returns. Only this search tool is loaded at first; matching tools are added to your " +
  "tool list on demand, so re-read your tool list after calling this and then call the " +
  "chosen tool directly with its own arguments. Describe the whole task in one query " +
  "(\"snapshot 110 then resize its disk\") and each intent is matched separately. " +
  "Results carry the tool's access tier and the gate arguments it will require; the gates " +
  "are enforced by the tool itself, so a tool appearing here is not permission to skip them.";

export const searchToolParameters = Type.Object(
  {
    query: Type.String({
      description: "What you are trying to do, in plain language. Multiple intents are fine.",
      minLength: 1,
    }),
    domain: Type.Optional(
      Type.Union(
        DOMAINS.map((d) => Type.Literal(d)),
        { description: "Optional hard filter to a single tool domain." },
      ),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 25,
        default: 5,
        description: "Maximum tools to return and load (default 5).",
      }),
    ),
  },
  { additionalProperties: false },
);

// The gate arguments each tier requires, mirrored from src/gates.ts so an agent can
// form a correct call in one attempt. Descriptive only: the executor enforces it.
const GATE_HINTS: Record<ToolTier, Record<string, unknown> | null> = {
  read: null,
  "safe-write": { confirm: true },
  destructive: { confirm: true, destructive: true, env: "PROXMOX_ENABLE_DESTRUCTIVE=1" },
};

export interface DeferredSession {
  isLoaded(name: string): boolean;
  loadedTools(): string[];
  /** Adds names to the visible set. Returns only the names that were not already loaded. */
  load(names: readonly string[]): string[];
}

// One session per connection. The visible set is connection-scoped: two clients on the
// same server process must not see each other's loaded tools.
export function createDeferredSession(): DeferredSession {
  const loaded = new Set<string>();
  return {
    isLoaded: (name) => loaded.has(name),
    loadedTools: () => [...loaded],
    load(names) {
      const added: string[] = [];
      for (const name of names) {
        if (!loaded.has(name)) {
          loaded.add(name);
          added.push(name);
        }
      }
      return added;
    },
  };
}

export interface SearchHitDescriptor {
  name: string;
  tier: ToolTier;
  domain: Domain;
  description: string;
  requires: Record<string, unknown> | null;
}

export interface SearchOutcome {
  hits: SearchHitDescriptor[];
  /** Newly loaded names. Empty means the caller must NOT emit list_changed. */
  added: string[];
  result: ReturnType<typeof jsonToolResult>;
}

export function runToolSearch(
  args: Record<string, unknown>,
  index: SearchRecord[],
  session: DeferredSession,
): SearchOutcome {
  const query = args.query;
  if (typeof query !== "string" || query.trim() === "") {
    throw new ToolInputError(`${SEARCH_TOOL_NAME} requires a non-empty "query" string.`);
  }
  const domain = args.domain === undefined ? undefined : (args.domain as Domain);
  if (domain !== undefined && !DOMAINS.includes(domain)) {
    throw new ToolInputError(
      `${SEARCH_TOOL_NAME}: unknown domain "${String(args.domain)}". Valid domains: ${DOMAINS.join(", ")}.`,
    );
  }
  const limit = typeof args.limit === "number" ? args.limit : 5;

  const hits = searchTools(query, index, { limit, domain }).map((h) => {
    const tier = TOOL_TIERS[h.name] ?? "safe-write"; // unknown tier: assume gated, never read
    return {
      name: h.name,
      tier,
      domain: h.domain,
      description: index.find((r) => r.name === h.name)?.description ?? "",
      requires: GATE_HINTS[tier],
    };
  });

  const added = session.load(hits.map((h) => h.name));

  return {
    hits,
    added,
    result: jsonToolResult({
      query,
      matched: hits.length,
      loaded: added,
      already_loaded: hits.filter((h) => !added.includes(h.name)).map((h) => h.name),
      tools: hits,
      next_step:
        hits.length === 0
          ? "No tool matched. Try naming the Proxmox object (snapshot, storage, ACL, backup job) rather than the outcome."
          : "These tools are now in your tool list. Re-read it, then call the one you want directly with its own arguments.",
    }),
  };
}
