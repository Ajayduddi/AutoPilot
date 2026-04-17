/**
 * @fileoverview config/context.config.
 *
 * High-level purpose:
 * Runtime configuration contracts, loading, and normalization for backend execution.
 *
 * Key Features (and trade-offs):
 * - Validates and shapes environment/runtime config values.
 * - Provides typed accessors for production-safe settings.
 * - Supports deterministic configuration behavior across environments.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Add new settings in centralized config contracts.
 * 3. Avoid scattering env access outside config modules.
 * 4. Typecheck and config tests should validate changes.
 * 5. Keep documentation aligned with behavior and tests.
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

type ContextConfig = {
  enabled: boolean;
  debug: boolean;
  maxRetrieval: number;
  modelMaxRetrieval: Record<string, number>;
  contentMaxLength: number;
  summaryMaxLength: number;
  targetWindowTokens: number;
  historyBudgetTokens: number;
  retrievedContextBudgetTokens: number;
  maxMessageTokens: number;
  maxContextItemTokens: number;
  cacheDataBudgetTokens: number;
  index: {
    workflowRuns: boolean;
    decisions: boolean;
    threadState: boolean;
  };
  ttlDays: number;
  cache: {
    enabled: boolean;
    staleMins: number;
  };
};

function getContextModeConfig(): ContextConfig {
  const runtime = getRuntimeConfig();
  return {
    enabled: runtime.contextMode.enabled,
    debug: runtime.contextMode.debug,
    maxRetrieval: runtime.contextMode.maxRetrieval,
    modelMaxRetrieval: runtime.contextMode.modelMaxRetrieval,
    contentMaxLength: runtime.contextMode.contentMaxLength,
    summaryMaxLength: runtime.contextMode.summaryMaxLength,
    targetWindowTokens: runtime.contextMode.targetWindowTokens,
    historyBudgetTokens: runtime.contextMode.historyBudgetTokens,
    retrievedContextBudgetTokens: runtime.contextMode.retrievedContextBudgetTokens,
    maxMessageTokens: runtime.contextMode.maxMessageTokens,
    maxContextItemTokens: runtime.contextMode.maxContextItemTokens,
    cacheDataBudgetTokens: runtime.contextMode.cacheDataBudgetTokens,
    index: {
      workflowRuns: runtime.contextMode.index.workflowRuns,
      decisions: runtime.contextMode.index.decisions,
      threadState: runtime.contextMode.index.threadState,
    },
    ttlDays: runtime.contextMode.ttlDays,
    cache: {
      enabled: runtime.contextMode.cache.enabled,
      staleMins: runtime.contextMode.cache.staleMins,
    },
  };
}

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
export const contextConfig: ContextConfig = {
  get enabled() {
    return getRuntimeConfig().contextMode.enabled;
  },
  get debug() {
    return getRuntimeConfig().contextMode.debug;
  },
  get maxRetrieval() {
    return getRuntimeConfig().contextMode.maxRetrieval;
  },
  get modelMaxRetrieval() {
    return getRuntimeConfig().contextMode.modelMaxRetrieval;
  },
  get contentMaxLength() {
    return getRuntimeConfig().contextMode.contentMaxLength;
  },
  get summaryMaxLength() {
    return getRuntimeConfig().contextMode.summaryMaxLength;
  },
  get targetWindowTokens() {
    return getRuntimeConfig().contextMode.targetWindowTokens;
  },
  get historyBudgetTokens() {
    return getRuntimeConfig().contextMode.historyBudgetTokens;
  },
  get retrievedContextBudgetTokens() {
    return getRuntimeConfig().contextMode.retrievedContextBudgetTokens;
  },
  get maxMessageTokens() {
    return getRuntimeConfig().contextMode.maxMessageTokens;
  },
  get maxContextItemTokens() {
    return getRuntimeConfig().contextMode.maxContextItemTokens;
  },
  get cacheDataBudgetTokens() {
    return getRuntimeConfig().contextMode.cacheDataBudgetTokens;
  },
  index: {
    get workflowRuns() {
      return getRuntimeConfig().contextMode.index.workflowRuns;
    },
    get decisions() {
      return getRuntimeConfig().contextMode.index.decisions;
    },
    get threadState() {
      return getRuntimeConfig().contextMode.index.threadState;
    },
  },
  get ttlDays() {
    return getRuntimeConfig().contextMode.ttlDays;
  },
  cache: {
    get enabled() {
      return getRuntimeConfig().contextMode.cache.enabled;
    },
    get staleMins() {
      return getRuntimeConfig().contextMode.cache.staleMins;
    },
  },
};

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
  const cfg = getContextModeConfig();
  const fallback = cfg.maxRetrieval;
  if (!model) return fallback;

  const normalized = model.trim().toLowerCase();
  if (!normalized) return fallback;

  // 1) Exact match
  const exact = cfg.modelMaxRetrieval[normalized];
  if (typeof exact === 'number') return exact;

  // 2) Prefix match (e.g. "gpt-4o" matches "gpt-4o-mini")
  for (const [key, value] of Object.entries(cfg.modelMaxRetrieval)) {
    if (normalized.startsWith(key)) return value;
  }

  // 3) Wildcard fallback, if provided
  const wildcard = cfg.modelMaxRetrieval['*'];
  if (typeof wildcard === 'number') return wildcard;

  return fallback;
}

/**
 * Strongly typed shape of {@link contextConfig}.
 */
export function getContextConfig(): ContextConfig {
  return getContextModeConfig();
}

export type { ContextConfig };
