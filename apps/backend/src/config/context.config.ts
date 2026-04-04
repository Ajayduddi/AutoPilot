/**
 * @fileoverview config/context.config.
 *
 * Runtime configuration loading, validation, and feature/runtime tuning controls.
 */
// ─────────────────────────────────────────────────────────────
//  Context Mode — Configuration
// ─────────────────────────────────────────────────────────────
//
//  Controls the context-mode integration layer.
//  All features degrade gracefully if context-mode is disabled
//  or if indexing/retrieval fails.
//
//  Runtime config keys:
//    CONTEXT_MODE_ENABLED          — master toggle (default: true)
//    CONTEXT_MODE_DEBUG            — verbose logging (default: false)
//    CONTEXT_MODE_MAX_RETRIEVAL    — max items returned per retrieval (default: 5)
//    CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON — model-specific max retrieval map
//    CONTEXT_MODE_CONTENT_MAX_LEN  — max chars stored per content field (default: 4000)
//    CONTEXT_MODE_SUMMARY_MAX_LEN  — max chars stored per summary field (default: 300)
//    CONTEXT_MODE_TARGET_WINDOW_TOKENS — target end-to-end context budget (default: 250000)
//    CONTEXT_MODE_HISTORY_BUDGET_TOKENS — chat history budget inside the target window
//    CONTEXT_MODE_RETRIEVED_CONTEXT_BUDGET_TOKENS — retrieved memory/workflow budget
//    CONTEXT_MODE_MAX_MESSAGE_TOKENS — cap per chat message before inclusion
//    CONTEXT_MODE_MAX_CONTEXT_ITEM_TOKENS — cap per retrieved context item before inclusion
//    CONTEXT_MODE_CACHE_DATA_BUDGET_TOKENS — cap for workflow/cache payload grounding
//    CONTEXT_MODE_INDEX_WORKFLOW_RUNS    — index workflow completions/failures (default: true)
//    CONTEXT_MODE_INDEX_DECISIONS        — index assistant routing decisions (default: true)
//    CONTEXT_MODE_INDEX_THREAD_STATE     — maintain per-thread state snapshots (default: true)
//    CONTEXT_MODE_TTL_DAYS              — auto-expire context items after N days (default: 30, 0=never)
//    CONTEXT_MODE_CACHE_ANSWER          — answer from cached workflow data instead of re-triggering (default: true)
//    CONTEXT_MODE_CACHE_STALE_MINS      — max age in minutes for cached data to be considered fresh (default: 15)
// ─────────────────────────────────────────────────────────────
import { getRuntimeConfig } from './runtime.config';

const runtime = getRuntimeConfig();

/**
 * Materialized context-mode configuration derived from runtime config.
 *
 * @remarks
 * This object is intentionally immutable (`as const`) and reused by retrieval,
 * indexing, and cache-based answer paths across the backend.
 *
 * @example
 * ```typescript
 * if (contextConfig.enabled) {
 *   console.log(contextConfig.maxRetrieval);
 * }
 * ```
 */
export const contextConfig = {
  /** Master toggle — when false, all indexing/retrieval is skipped */
  enabled: runtime.contextMode.enabled,

  /** Enable verbose debug logging for context operations */
  debug: runtime.contextMode.debug,

  /** Maximum number of context items returned per retrieval call */
  maxRetrieval: runtime.contextMode.maxRetrieval,

  /** Optional model-specific override map for max retrieval */
  modelMaxRetrieval: runtime.contextMode.modelMaxRetrieval,

  /** Maximum characters stored in the `content` field of a context item */
  contentMaxLength: runtime.contextMode.contentMaxLength,

  /** Maximum characters stored in the `summary` field */
  summaryMaxLength: runtime.contextMode.summaryMaxLength,

  /** Target long-context assembly budget */
  targetWindowTokens: runtime.contextMode.targetWindowTokens,

  /** Budget allocated to conversation history */
  historyBudgetTokens: runtime.contextMode.historyBudgetTokens,

  /** Budget allocated to retrieved context memory */
  retrievedContextBudgetTokens: runtime.contextMode.retrievedContextBudgetTokens,

  /** Maximum tokens retained from a single message */
  maxMessageTokens: runtime.contextMode.maxMessageTokens,

  /** Maximum tokens retained from a single context item */
  maxContextItemTokens: runtime.contextMode.maxContextItemTokens,

  /** Maximum tokens retained from cached workflow/result payloads */
  cacheDataBudgetTokens: runtime.contextMode.cacheDataBudgetTokens,

  /** Per-category indexing toggles */
  index: {
    workflowRuns: runtime.contextMode.index.workflowRuns,
    decisions: runtime.contextMode.index.decisions,
    threadState: runtime.contextMode.index.threadState,
  },

  /** Auto-expire context items after this many days (0 = never expire) */
  ttlDays: runtime.contextMode.ttlDays,

  /** Context-aware decisioning — answer from cached workflow results */
  cache: {
    /** Enable answering from cached workflow data instead of re-triggering */
    enabled: runtime.contextMode.cache.enabled,
    /** Max age in minutes for a cached workflow result to be considered fresh */
    staleMins: runtime.contextMode.cache.staleMins,
  },
} as const;

/**
 * Resolves model-specific retrieval limits with exact, prefix, and wildcard matching.
 *
 * @param model - LLM model identifier (for example, `gpt-4o-mini`).
 * @returns Maximum number of context items to retrieve for the model.
 *
 * @remarks
 * Match order is deterministic: exact key, prefix key, wildcard (`*`), then global default.
 *
 * @example
 * ```typescript
 * const limit = getContextMaxRetrievalForModel("gpt-4o-mini");
 * ```
 */
export function getContextMaxRetrievalForModel(model?: string): number {
  const fallback = contextConfig.maxRetrieval;
  if (!model) return fallback;

  const normalized = model.trim().toLowerCase();
  if (!normalized) return fallback;

  // 1) Exact match
  const exact = contextConfig.modelMaxRetrieval[normalized];
  if (typeof exact === 'number') return exact;

  // 2) Prefix match (e.g. "gpt-4o" matches "gpt-4o-mini")
  for (const [key, value] of Object.entries(contextConfig.modelMaxRetrieval)) {
    if (normalized.startsWith(key)) return value;
  }

  // 3) Wildcard fallback, if provided
  const wildcard = contextConfig.modelMaxRetrieval['*'];
  if (typeof wildcard === 'number') return wildcard;

  return fallback;
}

/**
 * Strongly typed shape of {@link contextConfig}.
 */
export type ContextConfig = typeof contextConfig;
