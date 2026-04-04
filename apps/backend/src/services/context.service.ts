/**
 * @fileoverview services/context.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { ContextRepo, type ContextItem, type ContextCategory } from '../repositories/context.repo';
import { contextConfig } from '../config/context.config';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../config/runtime.config';
import { WorkflowRepo } from '../repositories/workflow.repo';

// ─────────────────────────────────────────────────────────────
//  Types — Indexing inputs
// ─────────────────────────────────────────────────────────────

/** Input payload used when indexing a workflow run into context memory. */
export interface IndexWorkflowRunParams {
  threadId?: string;
  userId?: string;
    workflowRunId: string;
    workflowId: string;
    workflowKey: string;
    workflowName: string;
    provider: string;
    traceId: string;
    triggerSource: string;
    status: string;
  resultSummary?: string;
  resultData?: Record<string, unknown> | null;
  inputPayload?: Record<string, unknown> | null;
  rawProviderResponse?: unknown;
  errorPayload?: unknown;
  errorSummary?: string;
  originalQuestion?: string;
  snapshotPath?: string;
  snapshotBytes?: number;
  snapshotTokenEstimate?: number;
}

/**
 * IndexDecisionParams type contract.
 */
export interface IndexDecisionParams {
    threadId: string;
  userId?: string;
  /** The intent type selected: 'workflow' | 'chat' */
  intentType: string;
  /** Which workflow was selected, if any */
  workflowKey?: string;
  workflowId?: string;
  /** The original user message */
  userMessage: string;
  /** Whether the result answered the question */
  answeredQuestion?: boolean;
}

/**
 * UpdateThreadStateParams type contract.
 */
export interface UpdateThreadStateParams {
    threadId: string;
  userId?: string;
  lastWorkflowKey?: string;
  lastWorkflowRunId?: string;
  lastWorkflowStatus?: string;
  lastWorkflowName?: string;
  lastSubject?: string;
  recentWorkflows?: string[];
}

/**
 * IndexAuditEventParams type contract.
 */
export interface IndexAuditEventParams {
    threadId: string;
  userId?: string;
    action: string;
    summary: string;
  metadata?: Record<string, unknown>;
  workflowRunId?: string;
  workflowId?: string;
}

/**
 * RetrievalOptions type contract.
 */
export interface RetrievalOptions {
  limit?: number;
  categories?: ContextCategory[];
}

/**
 * PromptFormatOptions type contract.
 */
export interface PromptFormatOptions {
  maxTotalTokens?: number;
  maxTokensPerItem?: number;
  maxDecisionItems?: number;
}

/**
 * CacheHitResult type alias.
 */
export type CacheHitResult =
  | { hit: true; contextItem: ContextItem; cachedData: string; workflowName: string; ageSeconds: number }
  | { hit: false; reason: string };

/**
 * RelevantWorkflowRunMatch type alias.
 */
export type RelevantWorkflowRunMatch = {
    item: ContextItem;
    score: number;
    workflowKey: string;
    workflowName: string;
    runId: string;
  originalQuestion?: string;
    matchedTerms: string[];
};

// ─────────────────────────────────────────────────────────────
//  Logging helpers
// ─────────────────────────────────────────────────────────────

function logDebug(msg: string, ...args: unknown[]) {
  if (contextConfig.debug) {
    console.log(`[ContextService:DEBUG] ${msg}`, ...args);
  }
}

function logInfo(msg: string, ...args: unknown[]) {
  console.log(`[ContextService] ${msg}`, ...args);
}

function logError(msg: string, ...args: unknown[]) {
  console.error(`[ContextService:ERROR] ${msg}`, ...args);
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

function estimateTokens(text: string): number {
    const normalized = String(text || '');
  if (!normalized) return 0;
  return Math.ceil(normalized.length / 4);
}

function tokensToChars(tokens: number): number {
  return Math.max(64, Math.floor(Math.max(1, tokens) * 4));
}

function normalizeText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .replace(/[^a-z0-9_\-\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function recursiveLookup(value: unknown, targetKey: string, matches: unknown[], depth = 0): void {
  if (depth > 6 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) recursiveLookup(item, targetKey, matches, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (normalizeText(key) === targetKey) {
      matches.push(child);
    }
    recursiveLookup(child, targetKey, matches, depth + 1);
  }
}

function ensureWorkflowCacheDir(): string {
    const dir = path.join(getRuntimeConfig().homeDir, 'workflow-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function serializeSnapshotValue(label: string, value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return `${label}:\nnull`;
  if (typeof value === 'string') return `${label}:\n${value}`;
  try {
    return `${label}:\n${JSON.stringify(value, null, 2)}`;
  } catch {
    return `${label}:\n${String(value)}`;
  }
}

function buildWorkflowSnapshotText(input: {
  workflowName?: string;
  workflowKey?: string;
  provider?: string;
  status?: string;
  triggerSource?: string;
  originalQuestion?: string;
  inputPayload?: unknown;
  normalizedOutput?: unknown;
  rawProviderResponse?: unknown;
  errorPayload?: unknown;
}): string {
    const sections = [
    input.workflowName || input.workflowKey ? `Workflow: ${input.workflowName || input.workflowKey}${input.workflowKey ? ` (${input.workflowKey})` : ''}` : '',
    input.provider ? `Provider: ${input.provider}` : '',
    input.status ? `Status: ${input.status}` : '',
    input.triggerSource ? `Trigger: ${input.triggerSource}` : '',
    input.originalQuestion ? `Original question: ${input.originalQuestion}` : '',
    serializeSnapshotValue('Input payload', input.inputPayload),
    serializeSnapshotValue('Normalized output', input.normalizedOutput),
    serializeSnapshotValue('Raw provider response', input.rawProviderResponse),
    serializeSnapshotValue('Error payload', input.errorPayload),
  ].filter(Boolean);
  return sections.join('\n\n').trim();
}

/**
 * Compute a TTL expiry date from config.
 */
function computeExpiry(): Date | undefined {
  if (contextConfig.ttlDays <= 0) return undefined;
    const d = new Date();
  d.setDate(d.getDate() + contextConfig.ttlDays);
  return d;
}

/**
 * Extract top-level keys and notable string values from an object.
 * Used to create a compressed representation of workflow output data.
 */
function extractEntities(data: Record<string, unknown>): string[] {
    const entities: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.length > 0 && value.length < 200) {
      entities.push(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Go one level deep
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        if (typeof subVal === 'string' && subVal.length > 0 && subVal.length < 200) {
          entities.push(subVal);
        }
      }
    }
  }
  return entities.slice(0, 20); // Cap at 20 entities
}

/**
 * Build a compressed content string from workflow result data.
 * Captures structure and key values without dumping the full payload.
 */
function compressResultData(data: Record<string, unknown>): string {
    const lines: string[] = [];
    const dataStr = JSON.stringify(data, null, 2);

  if (dataStr.length <= contextConfig.contentMaxLength) {
    return dataStr;
  }

  // For large payloads, build a structural summary
  lines.push('Data structure:');
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`  ${key}: Array[${value.length}]`);
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
        lines.push(`    sample keys: ${Object.keys(value[0]).join(', ')}`);
      }
    } else if (typeof value === 'object' && value !== null) {
            const keys = Object.keys(value);
      lines.push(`  ${key}: Object{${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}}`);
    } else if (typeof value === 'string') {
      lines.push(`  ${key}: "${truncate(value, 100)}"`);
    } else {
      lines.push(`  ${key}: ${String(value)}`);
    }
  }

  // Include notable values
    const entities = extractEntities(data);
  if (entities.length > 0) {
    lines.push('');
    lines.push('Notable values:');
    entities.forEach(e => lines.push(`  - ${e}`));
  }

  return truncate(lines.join('\n'), contextConfig.contentMaxLength);
}

// ─────────────────────────────────────────────────────────────
//  ContextService
// ─────────────────────────────────────────────────────────────

/**
 * Service that indexes, retrieves, and formats conversational context memory.
 *
 * @remarks
 * This service is the orchestration layer over context persistence and
 * retrieval heuristics used by chat and workflow-follow-up experiences.
 *
 * @example
 * ```typescript
 * await ContextService.updateThreadState({ threadId, lastWorkflowKey: "send_report" });
 * ```
 */
export class ContextService {

  // ═══════════════════════════════════════════════════════════
  //  INDEXING
  // ═══════════════════════════════════════════════════════════

  /**
   * Index a completed or failed workflow run into context memory.
   * Called after workflow execution completes.
   */
  static async indexWorkflowRun(params: IndexWorkflowRunParams): Promise<void> {
    if (!contextConfig.enabled || !contextConfig.index.workflowRuns) {
      logDebug('Skipping workflow run indexing (disabled)');
      return;
    }

    try {
      // Build content string — compressed representation of the result
            const contentParts: string[] = [];
      contentParts.push(`Workflow: ${params.workflowName} (${params.workflowKey})`);
      contentParts.push(`Provider: ${params.provider}`);
      contentParts.push(`Status: ${params.status}`);
      contentParts.push(`Trigger: ${params.triggerSource}`);

      if (params.originalQuestion) {
        contentParts.push(`User asked: "${params.originalQuestion}"`);
      }

      if (params.resultSummary) {
        contentParts.push(`Summary: ${params.resultSummary}`);
      }

      if (params.resultData) {
        contentParts.push('');
        contentParts.push(compressResultData(params.resultData));
      }

      if (params.errorSummary) {
        contentParts.push(`Error: ${params.errorSummary}`);
      }

            const content = truncate(contentParts.join('\n'), contextConfig.contentMaxLength);

      // Build summary — one-liner
            const summary = truncate(
        `${params.workflowKey} ${params.status}${params.resultSummary ? ': ' + params.resultSummary : ''}`,
        contextConfig.summaryMaxLength,
      );

      // Build metadata — structured, searchable
            const metadata: Record<string, unknown> = {
        workflowKey: params.workflowKey,
        workflowName: params.workflowName,
        provider: params.provider,
        status: params.status,
        runId: params.workflowRunId,
        traceId: params.traceId,
        triggerSource: params.triggerSource,
      };

      if (params.originalQuestion) {
        metadata.originalQuestion = params.originalQuestion;
      }

      if (params.resultData) {
        metadata.dataKeys = Object.keys(params.resultData);
        metadata.entities = extractEntities(params.resultData);
      }
      if (params.snapshotPath) {
        metadata.snapshotPath = params.snapshotPath;
        metadata.snapshotBytes = params.snapshotBytes ?? 0;
        metadata.snapshotTokenEstimate = params.snapshotTokenEstimate ?? 0;
      }

      await ContextRepo.create({
        id: randomUUID(),
        threadId: params.threadId,
        userId: params.userId,
        category: 'workflow_run',
        workflowRunId: params.workflowRunId,
        workflowId: params.workflowId,
        content,
        summary,
        metadata,
        expiresAt: computeExpiry(),
      });

      logDebug(`Indexed workflow run: ${params.workflowRunId} (${params.workflowKey} → ${params.status})`);

      // Also update thread state if we have a threadId
      if (params.threadId) {
        await this.updateThreadState({
          threadId: params.threadId,
          userId: params.userId,
          lastWorkflowKey: params.workflowKey,
          lastWorkflowRunId: params.workflowRunId,
          lastWorkflowStatus: params.status,
          lastWorkflowName: params.workflowName,
        });
      }
    } catch (err) {
      logError('Failed to index workflow run:', err);
      // Graceful degradation — don't throw
    }
  }

  /**
   * Index an assistant routing decision.
   * Called after intent parsing determines the response path.
   */
  static async indexAssistantDecision(params: IndexDecisionParams): Promise<void> {
    if (!contextConfig.enabled || !contextConfig.index.decisions) {
      logDebug('Skipping decision indexing (disabled)');
      return;
    }

    try {
            const content = [
        `Intent: ${params.intentType}`,
        params.workflowKey ? `Selected workflow: ${params.workflowKey}` : 'No workflow selected',
        `User said: "${truncate(params.userMessage, 200)}"`,
        params.answeredQuestion !== undefined
          ? `Answered user question: ${params.answeredQuestion ? 'yes' : 'no'}`
          : '',
      ].filter(Boolean).join('\n');

            const summary = truncate(
        `${params.intentType}${params.workflowKey ? ' → ' + params.workflowKey : ''}: "${params.userMessage.slice(0, 80)}"`,
        contextConfig.summaryMaxLength,
      );

      await ContextRepo.create({
        id: randomUUID(),
        threadId: params.threadId,
        userId: params.userId,
        category: 'assistant_decision',
        workflowId: params.workflowId,
        content,
        summary,
        metadata: {
          intentType: params.intentType,
          workflowKey: params.workflowKey,
          answeredQuestion: params.answeredQuestion,
        },
        expiresAt: computeExpiry(),
      });

      logDebug(`Indexed decision: ${params.intentType}${params.workflowKey ? ' → ' + params.workflowKey : ''}`);
    } catch (err) {
      logError('Failed to index assistant decision:', err);
    }
  }

  /**
   * Update (upsert) the thread-level state snapshot.
   * There is exactly one thread_state per thread.
   */
  static async updateThreadState(params: UpdateThreadStateParams): Promise<void> {
    if (!contextConfig.enabled || !contextConfig.index.threadState) {
      logDebug('Skipping thread state update (disabled)');
      return;
    }

    try {
      // Fetch current state to merge
            const existing = await ContextRepo.getThreadState(params.threadId);
            const existingMeta = (existing?.metadata as Record<string, unknown>) || {};

      // Merge recent workflows list
            const recentWorkflows = (existingMeta.recentWorkflows as string[]) || [];
      if (params.lastWorkflowKey && !recentWorkflows.includes(params.lastWorkflowKey)) {
        recentWorkflows.push(params.lastWorkflowKey);
        // Keep only last 10
        if (recentWorkflows.length > 10) recentWorkflows.shift();
      }

            const metadata: Record<string, unknown> = {
        ...existingMeta,
        lastWorkflowKey: params.lastWorkflowKey ?? existingMeta.lastWorkflowKey,
        lastWorkflowRunId: params.lastWorkflowRunId ?? existingMeta.lastWorkflowRunId,
        lastWorkflowStatus: params.lastWorkflowStatus ?? existingMeta.lastWorkflowStatus,
        lastWorkflowName: params.lastWorkflowName ?? existingMeta.lastWorkflowName,
        lastSubject: params.lastSubject ?? existingMeta.lastSubject,
        recentWorkflows,
      };

            const contentParts: string[] = [];
      if (metadata.lastWorkflowName) contentParts.push(`Last workflow: ${metadata.lastWorkflowName} (${metadata.lastWorkflowStatus})`);
      if (metadata.lastSubject) contentParts.push(`Last subject: ${metadata.lastSubject}`);
      if (recentWorkflows.length > 0) contentParts.push(`Recent workflows: ${recentWorkflows.join(', ')}`);

      await ContextRepo.upsertThreadState({
        id: existing?.id || randomUUID(),
        threadId: params.threadId,
        userId: params.userId,
        category: 'thread_state',
        content: contentParts.join('\n') || 'Empty thread state',
        summary: `Thread state — last: ${metadata.lastWorkflowKey || 'none'}`,
        metadata,
        expiresAt: computeExpiry(),
      });

      logDebug(`Updated thread state for ${params.threadId}`);
    } catch (err) {
      logError('Failed to update thread state:', err);
    }
  }

    static async indexAuditEvent(params: IndexAuditEventParams): Promise<void> {
    if (!contextConfig.enabled) return;

    try {
      await ContextRepo.create({
        id: randomUUID(),
        threadId: params.threadId,
        userId: params.userId,
        category: 'audit_event',
        workflowRunId: params.workflowRunId,
        workflowId: params.workflowId,
        content: truncate(params.summary, contextConfig.contentMaxLength),
        summary: truncate(`${params.action}: ${params.summary}`, contextConfig.summaryMaxLength),
        metadata: {
          action: params.action,
          ...(params.metadata || {}),
        },
        expiresAt: computeExpiry(),
      });
    } catch (err) {
      logError('Failed to index audit event:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  RETRIEVAL
  // ═══════════════════════════════════════════════════════════

  /**
   * Get relevant context for a thread.
   * Returns recent context items across all categories.
   */
  static async getThreadContext(
    threadId: string,
    options?: RetrievalOptions,
  ): Promise<ContextItem[]> {
    if (!contextConfig.enabled) return [];

    try {
            const limit = options?.limit ?? contextConfig.maxRetrieval;

      if (options?.categories && options.categories.length > 0) {
        // Fetch each category and merge
                const results: ContextItem[] = [];
        for (const cat of options.categories) {
                    const items = await ContextRepo.getByThreadAndCategory(threadId, cat, limit);
          results.push(...items);
        }
        // Sort by recency, cap at limit
        return results
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, limit);
      }

      return ContextRepo.getByThread(threadId, limit);
    } catch (err) {
      logError('Failed to retrieve thread context:', err);
      return []; // Graceful degradation
    }
  }

  /**
   * Get the most recent workflow run context item for a thread.
   * Used to resolve "run it again", "previous result", etc.
   */
  static async getLastWorkflowContext(threadId: string): Promise<ContextItem | null> {
    if (!contextConfig.enabled) return null;

    try {
      return ContextRepo.getLastWorkflowRun(threadId);
    } catch (err) {
      logError('Failed to retrieve last workflow context:', err);
      return null;
    }
  }

    static async getAuditEvents(threadId: string, limit = 50): Promise<ContextItem[]> {
    if (!contextConfig.enabled) return [];

    try {
      return ContextRepo.getByThreadAndCategory(threadId, 'audit_event', limit);
    } catch (err) {
      logError('Failed to retrieve audit events:', err);
      return [];
    }
  }

  /**
   * Get the thread state snapshot.
   * Returns structured metadata about the thread's recent activity.
   */
  static async getThreadState(threadId: string): Promise<ContextItem | null> {
    if (!contextConfig.enabled) return null;

    try {
      return ContextRepo.getThreadState(threadId);
    } catch (err) {
      logError('Failed to retrieve thread state:', err);
      return null;
    }
  }

  /**
   * Search context items for a thread by query text.
   */
  static async searchContext(
    threadId: string,
    query: string,
    limit?: number,
  ): Promise<ContextItem[]> {
    if (!contextConfig.enabled) return [];

    try {
      return ContextRepo.searchInThread(threadId, query, limit ?? contextConfig.maxRetrieval);
    } catch (err) {
      logError('Failed to search context:', err);
      return [];
    }
  }

  /**
   * Resolve a workflow reference like "it", "that workflow", "previous result".
   * Returns the most relevant workflow context item for the reference.
   */
  static async resolveWorkflowReference(
    threadId: string,
    reference: string,
  ): Promise<ContextItem | null> {
    if (!contextConfig.enabled) return null;

    try {
      // For vague references, return the most recent workflow run
            const vagueRefs = ['it', 'that', 'again', 'previous', 'last', 'same', 'the workflow'];
            const isVague = vagueRefs.some(r => reference.toLowerCase().includes(r));

      if (isVague) {
        return ContextRepo.getLastWorkflowRun(threadId);
      }

      // Try searching by the reference text
            const results = await ContextRepo.searchInThread(threadId, reference, 1);
      if (results.length > 0 && results[0].category === 'workflow_run') {
        return results[0];
      }

      // Fallback to most recent
      return ContextRepo.getLastWorkflowRun(threadId);
    } catch (err) {
      logError('Failed to resolve workflow reference:', err);
      return null;
    }
  }

  /**
   * Patch the original user question into the most recent workflow_run context item.
   * Called from the orchestrator after workflow execution, since WorkflowService
   * doesn't have access to the user's message.
   */
  static async patchWorkflowRunQuestion(
    threadId: string,
    runId: string,
    originalQuestion: string,
  ): Promise<void> {
    if (!contextConfig.enabled) return;

    try {
            const lastRun = await ContextRepo.getLastWorkflowRun(threadId);
      if (!lastRun) return;

      // Verify this is the right run (by runId in metadata)
            const meta = (lastRun.metadata as Record<string, unknown>) || {};
      if (meta.runId && meta.runId !== runId) return;

      meta.originalQuestion = originalQuestion;

      // Prepend the question to content for text search matching
            const enrichedContent = `User asked: "${truncate(originalQuestion, 200)}"\n${lastRun.content}`;

      await ContextRepo.updateById(lastRun.id, {
        content: truncate(enrichedContent, contextConfig.contentMaxLength),
        metadata: meta,
      });

      logDebug(`Patched original question into workflow run context: ${runId.slice(0, 8)}`);
    } catch (err) {
      logError('Failed to patch workflow run question:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CONTEXT-AWARE DECISIONING (Stage 4)
  // ═══════════════════════════════════════════════════════════
  //
  //  Retrieval Policy:
  //  ─────────────────
  //  When the LLM resolves intent as { type: 'workflow', workflowKey },
  //  the orchestrator calls evaluateCacheHit() BEFORE executing.
  //
  //  A cache hit is returned when ALL of these conditions are true:
  //    1. Context-mode AND cache answering are enabled
  //    2. The same workflowKey has a successful run in this thread's context
  //    3. The cached result is fresh (within CONTEXT_MODE_CACHE_STALE_MINS)
  //    4. The intent has no new parameters (empty or missing parameters object)
  //    5. The cached content has meaningful data (non-empty content field)
  //
  //  Cache is deliberately BYPASSED when:
  //    - The user provides new input parameters (e.g. a search query)
  //    - The intent came from a deterministic "retry" follow-up (caller skips check)
  //    - The previous run for that workflow failed
  //    - The cached data is stale (older than staleMins)
  //
  //  Result: CacheHitResult — either { hit: true, contextItem, cachedData }
  //  for use in streaming an answer, or { hit: false, reason } for logging.
  // ═══════════════════════════════════════════════════════════

  /**
   * Evaluate whether a workflow intent can be answered from cached context
   * instead of re-executing the workflow.
   */
  static async evaluateCacheHit(
    threadId: string,
    workflowKey: string,
    parameters?: Record<string, any>,
  ): Promise<CacheHitResult> {
    // Gate 1: Feature flags
    if (!contextConfig.enabled || !contextConfig.cache.enabled) {
      return { hit: false, reason: 'cache_disabled' };
    }

    // Gate 2: Non-empty parameters means fresh execution needed
    if (parameters && Object.keys(parameters).length > 0) {
      return { hit: false, reason: 'has_parameters' };
    }

    try {
      // Gate 3: Find a recent run of the same workflow in this thread
            const items = await ContextRepo.getByThreadAndCategory(threadId, 'workflow_run', 5);
            const matchingRun = items.find(item => {
                const meta = item.metadata as Record<string, unknown> | null;
        return meta?.workflowKey === workflowKey;
      });

      if (!matchingRun) {
        return { hit: false, reason: 'no_cached_run' };
      }

      // Gate 4: Must have been a successful run
            const meta = matchingRun.metadata as Record<string, unknown>;
      if (meta.status !== 'completed') {
        return { hit: false, reason: 'previous_run_failed' };
      }

      // Gate 5: Freshness check — within staleMins
            const ageMs = Date.now() - new Date(matchingRun.createdAt).getTime();
            const staleLimitMs = contextConfig.cache.staleMins * 60 * 1000;
      if (ageMs > staleLimitMs) {
        return { hit: false, reason: 'stale_data' };
      }

      // Gate 6: Content must be meaningful
      if (!matchingRun.content || matchingRun.content.length < 20) {
        return { hit: false, reason: 'empty_content' };
      }

      logDebug(`Cache HIT for ${workflowKey} in thread ${threadId} (age: ${Math.round(ageMs / 1000)}s)`);
      return {
        hit: true,
        contextItem: matchingRun,
        cachedData: matchingRun.content,
        workflowName: (meta.workflowName as string) || workflowKey,
        ageSeconds: Math.round(ageMs / 1000),
      };
    } catch (err) {
      logError('Failed to evaluate cache hit:', err);
      return { hit: false, reason: 'retrieval_error' };
    }
  }

  static async findRelevantWorkflowRuns(
    threadId: string,
    question: string,
    options?: { limit?: number; preferredWorkflowKey?: string },
  ): Promise<RelevantWorkflowRunMatch[]> {
    if (!contextConfig.enabled) return [];

    try {
            const items = await ContextRepo.getByThreadAndCategory(threadId, 'workflow_run', 20);
            const queryTokens = new Set(tokenize(question));
            const preferredWorkflowKey = normalizeText(options?.preferredWorkflowKey);
            const scored = items.map((item) => {
                const meta = (item.metadata as Record<string, unknown> | null) || {};
                const workflowKey = String(meta.workflowKey || '');
                const workflowName = String(meta.workflowName || workflowKey || 'workflow');
                const runId = String(meta.runId || item.workflowRunId || '');
                const originalQuestion = typeof meta.originalQuestion === 'string' ? meta.originalQuestion : undefined;
                const searchable = [
          workflowKey,
          workflowName,
          originalQuestion || '',
          item.summary || '',
          item.content,
        ].join('\n');
                const matchedTerms: string[] = [];
                let score = 0;

        if (preferredWorkflowKey && normalizeText(workflowKey) === preferredWorkflowKey) {
          score += 15;
          matchedTerms.push(`preferred:${workflowKey}`);
        }

                const haystack = normalizeText(searchable);
        for (const token of queryTokens) {
          if (!token) continue;
          if (haystack.includes(token)) {
            score += 2;
            matchedTerms.push(token);
          }
        }

        if (originalQuestion && normalizeText(question) && normalizeText(originalQuestion).includes(normalizeText(question))) {
          score += 8;
          matchedTerms.push('original_question');
        }

        if (String(meta.status || '') === 'completed') {
          score += 2;
        }

                const ageHours = Math.max(0, (Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60));
        score += Math.max(0, 6 - Math.min(6, ageHours));

        return {
          item,
          score,
          workflowKey,
          workflowName,
          runId,
          originalQuestion,
          matchedTerms: [...new Set(matchedTerms)].slice(0, 8),
        } satisfies RelevantWorkflowRunMatch;
      });

      return scored
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, options?.limit ?? 5));
    } catch (err) {
      logError('Failed to find relevant workflow runs:', err);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  FORMATTING
  // ═══════════════════════════════════════════════════════════

  /**
   * Format retrieved context items into a structured section
   * suitable for injection into LLM prompts.
   *
   * Returns empty string if no items — caller can skip injection.
   */
  static formatForPrompt(items: ContextItem[], options?: PromptFormatOptions): string {
    if (!items || items.length === 0) return '';

        const maxTotalTokens = Math.max(512, options?.maxTotalTokens ?? contextConfig.retrievedContextBudgetTokens);
        const maxTokensPerItem = Math.max(128, options?.maxTokensPerItem ?? contextConfig.maxContextItemTokens);
        const maxDecisionItems = Math.max(1, options?.maxDecisionItems ?? 6);
        const sections: string[] = [];
    sections.push('=== RETRIEVED CONTEXT ===');
        let usedTokens = estimateTokens(sections[0]);

        const pushWithinBudget = (text: string, opts?: { itemCapTokens?: number }): boolean => {
            const raw = String(text || '');
      if (!raw.trim()) return true;
            const perItemChars = tokensToChars(opts?.itemCapTokens ?? maxTokensPerItem);
            const remainingChars = tokensToChars(maxTotalTokens - usedTokens);
      if (remainingChars <= 32) return false;
            const clipped = truncate(raw, Math.min(perItemChars, remainingChars));
      if (!clipped.trim()) return false;
      sections.push(clipped);
      usedTokens += estimateTokens(clipped);
      return usedTokens < maxTotalTokens;
    };

    // Group by category
        const threadStates = items.filter(i => i.category === 'thread_state');
        const workflowRuns = items.filter(i => i.category === 'workflow_run');
        const decisions = items.filter(i => i.category === 'assistant_decision');

    // Thread state: expose lastWorkflowKey prominently for follow-up resolution
    if (threadStates.length > 0) {
      if (!pushWithinBudget('\n[Thread State]', { itemCapTokens: 128 })) return sections.join('\n');
      for (const item of threadStates) {
                const meta = item.metadata as Record<string, unknown> | null;
        if (meta) {
          if (meta.lastWorkflowKey && !pushWithinBudget(`lastWorkflowKey: ${meta.lastWorkflowKey}`, { itemCapTokens: 96 })) return sections.join('\n');
          if (meta.lastWorkflowName && !pushWithinBudget(`lastWorkflowName: ${meta.lastWorkflowName}`, { itemCapTokens: 96 })) return sections.join('\n');
          if (meta.lastWorkflowStatus && !pushWithinBudget(`lastWorkflowStatus: ${meta.lastWorkflowStatus}`, { itemCapTokens: 96 })) return sections.join('\n');
          if (meta.lastSubject && !pushWithinBudget(`lastSubject: ${meta.lastSubject}`, { itemCapTokens: 128 })) return sections.join('\n');
                    const recent = meta.recentWorkflows as string[] | undefined;
          if (recent?.length && !pushWithinBudget(`recentWorkflows: ${recent.join(', ')}`, { itemCapTokens: 160 })) return sections.join('\n');
        }
      }
    }

    // Workflow runs: concise key-value format
    if (workflowRuns.length > 0) {
      if (!pushWithinBudget('\n[Recent Workflow Results]', { itemCapTokens: 128 })) return sections.join('\n');
      for (const item of workflowRuns) {
                const meta = item.metadata as Record<string, unknown> | null;
                const key = meta?.workflowKey || 'unknown';
                const status = meta?.status || 'unknown';
        if (!pushWithinBudget(`--- ${key} (${status}) ---`, { itemCapTokens: 96 })) return sections.join('\n');
        if (!pushWithinBudget(item.content, { itemCapTokens: maxTokensPerItem })) return sections.join('\n');
      }
    }

    // Decisions: one-line summaries only
    if (decisions.length > 0) {
      if (!pushWithinBudget('\n[Recent Decisions]', { itemCapTokens: 96 })) return sections.join('\n');
      for (const item of decisions.slice(0, maxDecisionItems)) {
        if (!pushWithinBudget(`- ${item.summary}`, { itemCapTokens: 96 })) return sections.join('\n');
      }
    }

    pushWithinBudget('=== END CONTEXT ===', { itemCapTokens: 64 });
    return sections.join('\n');
  }

  static async persistWorkflowRunSnapshot(input: {
        workflowRunId: string;
        workflowKey: string;
        workflowName: string;
        provider: string;
        status: string;
        triggerSource: string;
    originalQuestion?: string;
    inputPayload?: unknown;
    normalizedOutput?: unknown;
    rawProviderResponse?: unknown;
    errorPayload?: unknown;
  }): Promise<{ path: string; bytes: number; tokenEstimate: number }> {
        const text = buildWorkflowSnapshotText(input);
        const cacheDir = ensureWorkflowCacheDir();
        const snapshotPath = path.join(cacheDir, `${input.workflowRunId}.txt`);
    fs.writeFileSync(snapshotPath, text, 'utf8');
        const bytes = Buffer.byteLength(text, 'utf8');
    return {
      path: snapshotPath,
      bytes,
      tokenEstimate: estimateTokens(text),
    };
  }

    static async loadCompleteWorkflowCache(item: ContextItem): Promise<string> {
        const meta = (item.metadata as Record<string, unknown> | null) || {};
        const snapshotPath = typeof meta.snapshotPath === 'string' ? meta.snapshotPath : '';
    if (snapshotPath && fs.existsSync(snapshotPath)) {
      try {
        return fs.readFileSync(snapshotPath, 'utf8');
      } catch (err) {
        logError(`Failed to read workflow snapshot at ${snapshotPath}:`, err);
      }
    }

        const runId = typeof meta.runId === 'string' ? meta.runId : item.workflowRunId || '';
    if (runId) {
      try {
                const run = await WorkflowRepo.getRunById(runId);
        if (run) {
          return buildWorkflowSnapshotText({
            workflowName: String(meta.workflowName || meta.workflowKey || ''),
            workflowKey: String(meta.workflowKey || ''),
            provider: String(meta.provider || ''),
            status: String(meta.status || ''),
            triggerSource: String(meta.triggerSource || ''),
                        originalQuestion: typeof meta.originalQuestion === 'string' ? meta.originalQuestion : undefined,
            inputPayload: run.inputPayload,
            normalizedOutput: run.normalizedOutput,
            rawProviderResponse: run.rawProviderResponse,
            errorPayload: run.errorPayload,
          });
        }
      } catch (err) {
        logError(`Failed to hydrate workflow run ${runId}:`, err);
      }
    }

    return item.content;
  }

  static async extractWorkflowRunFields(
    item: ContextItem,
    fields: string[],
  ): Promise<{ values: Record<string, unknown>; missing: string[]; source: 'normalized_output' | 'snapshot_text' | 'context_content' }> {
        const normalizedFields = [...new Set(fields.map((field) => normalizeText(field)).filter(Boolean))];
        const values: Record<string, unknown> = {};
        const missing: string[] = [];
        const meta = (item.metadata as Record<string, unknown> | null) || {};
        const runId = typeof meta.runId === 'string' ? meta.runId : item.workflowRunId || '';

    if (runId) {
      try {
                const run = await WorkflowRepo.getRunById(runId);
        if (run?.normalizedOutput && typeof run.normalizedOutput === 'object') {
          for (const field of normalizedFields) {
                        const matches: unknown[] = [];
            recursiveLookup(run.normalizedOutput, field, matches);
            if (matches.length === 1) values[field] = matches[0];
            else if (matches.length > 1) values[field] = matches;
            else missing.push(field);
          }
          return { values, missing, source: 'normalized_output' };
        }
      } catch (err) {
        logError(`Failed to extract workflow fields from run ${runId}:`, err);
      }
    }

        const fullText = await this.loadCompleteWorkflowCache(item);
    for (const field of normalizedFields) {
            const pattern = new RegExp(`${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:=]\\s*(.+)`, 'i');
            const match = fullText.match(pattern);
      if (match?.[1]) values[field] = truncate(match[1].trim(), 500);
      else missing.push(field);
    }

    if (Object.keys(values).length > 0 || fullText !== item.content) {
      return { values, missing, source: 'snapshot_text' };
    }

    return { values, missing, source: 'context_content' };
  }

  // ═══════════════════════════════════════════════════════════
  //  MAINTENANCE
  // ═══════════════════════════════════════════════════════════

  /**
   * Clean up expired context items.
   * Should be called periodically (e.g., via cron or on-demand).
   */
  static async cleanup(): Promise<number> {
    if (!contextConfig.enabled) return 0;

    try {
            const count = await ContextRepo.deleteExpired();
      if (count > 0) logInfo(`Cleaned up ${count} expired context items`);
      return count;
    } catch (err) {
      logError('Failed to cleanup expired context:', err);
      return 0;
    }
  }

  /**
   * Delete all context for a thread (cascade on thread deletion).
   */
  static async deleteThreadContext(threadId: string): Promise<void> {
    try {
            const count = await ContextRepo.deleteByThread(threadId);
      logDebug(`Deleted ${count} context items for thread ${threadId}`);
    } catch (err) {
      logError('Failed to delete thread context:', err);
    }
  }

  /**
   * Check if context-mode is enabled and operational.
   */
  static isEnabled(): boolean {
    return contextConfig.enabled;
  }
}
