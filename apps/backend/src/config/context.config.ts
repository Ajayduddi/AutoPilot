// ─────────────────────────────────────────────────────────────
//  Context Mode — Configuration
// ─────────────────────────────────────────────────────────────
//
//  Controls the context-mode integration layer.
//  All features degrade gracefully if context-mode is disabled
//  or if indexing/retrieval fails.
//
//  Env vars:
//    CONTEXT_MODE_ENABLED          — master toggle (default: true)
//    CONTEXT_MODE_DEBUG            — verbose logging (default: false)
//    CONTEXT_MODE_MAX_RETRIEVAL    — max items returned per retrieval (default: 5)
//    CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON — model-specific max retrieval map JSON
//    CONTEXT_MODE_CONTENT_MAX_LEN  — max chars stored per content field (default: 4000)
//    CONTEXT_MODE_SUMMARY_MAX_LEN  — max chars stored per summary field (default: 300)
//    CONTEXT_MODE_INDEX_WORKFLOW_RUNS    — index workflow completions/failures (default: true)
//    CONTEXT_MODE_INDEX_DECISIONS        — index assistant routing decisions (default: true)
//    CONTEXT_MODE_INDEX_THREAD_STATE     — maintain per-thread state snapshots (default: true)
//    CONTEXT_MODE_TTL_DAYS              — auto-expire context items after N days (default: 30, 0=never)
//    CONTEXT_MODE_CACHE_ANSWER          — answer from cached workflow data instead of re-triggering (default: true)
//    CONTEXT_MODE_CACHE_STALE_MINS      — max age in minutes for cached data to be considered fresh (default: 15)
// ─────────────────────────────────────────────────────────────

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const parsed = parseInt(v, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envString(key: string, fallback: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v;
}

function parseModelMaxRetrievalMap(raw: string): Record<string, number> {
  if (!raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};

    const entries = Object.entries(parsed as Record<string, unknown>);
    const map: Record<string, number> = {};

    for (const [key, value] of entries) {
      if (!key) continue;
      const n = typeof value === 'number' ? value : parseInt(String(value), 10);
      if (Number.isNaN(n) || n <= 0) continue;
      map[key.trim().toLowerCase()] = n;
    }

    return map;
  } catch (err) {
    console.warn('[ContextConfig] Invalid CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON, using defaults.', err);
    return {};
  }
}

export const contextConfig = {
  /** Master toggle — when false, all indexing/retrieval is skipped */
  enabled: envBool('CONTEXT_MODE_ENABLED', true),

  /** Enable verbose debug logging for context operations */
  debug: envBool('CONTEXT_MODE_DEBUG', false),

  /** Maximum number of context items returned per retrieval call */
  maxRetrieval: envInt('CONTEXT_MODE_MAX_RETRIEVAL', 5),

  /** Optional model-specific override map for max retrieval (JSON object) */
  modelMaxRetrieval: parseModelMaxRetrievalMap(envString('CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON', '')),

  /** Maximum characters stored in the `content` field of a context item */
  contentMaxLength: envInt('CONTEXT_MODE_CONTENT_MAX_LEN', 4000),

  /** Maximum characters stored in the `summary` field */
  summaryMaxLength: envInt('CONTEXT_MODE_SUMMARY_MAX_LEN', 300),

  /** Per-category indexing toggles */
  index: {
    workflowRuns: envBool('CONTEXT_MODE_INDEX_WORKFLOW_RUNS', true),
    decisions: envBool('CONTEXT_MODE_INDEX_DECISIONS', true),
    threadState: envBool('CONTEXT_MODE_INDEX_THREAD_STATE', true),
  },

  /** Auto-expire context items after this many days (0 = never expire) */
  ttlDays: envInt('CONTEXT_MODE_TTL_DAYS', 30),

  /** Context-aware decisioning — answer from cached workflow results */
  cache: {
    /** Enable answering from cached workflow data instead of re-triggering */
    enabled: envBool('CONTEXT_MODE_CACHE_ANSWER', true),
    /** Max age in minutes for a cached workflow result to be considered fresh */
    staleMins: envInt('CONTEXT_MODE_CACHE_STALE_MINS', 15),
  },
} as const;

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

export type ContextConfig = typeof contextConfig;
