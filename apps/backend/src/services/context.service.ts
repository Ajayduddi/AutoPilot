import { ContextRepo, type ContextItem, type ContextCategory } from '../repositories/context.repo';
import { contextConfig } from '../config/context.config';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────
//  Types — Indexing inputs
// ─────────────────────────────────────────────────────────────

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
  errorSummary?: string;
  originalQuestion?: string;
}

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

export interface RetrievalOptions {
  limit?: number;
  categories?: ContextCategory[];
}

export type CacheHitResult =
  | { hit: true; contextItem: ContextItem; cachedData: string; workflowName: string; ageSeconds: number }
  | { hit: false; reason: string };

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

  // ═══════════════════════════════════════════════════════════
  //  FORMATTING
  // ═══════════════════════════════════════════════════════════

  /**
   * Format retrieved context items into a structured section
   * suitable for injection into LLM prompts.
   *
   * Returns empty string if no items — caller can skip injection.
   */
  static formatForPrompt(items: ContextItem[]): string {
    if (!items || items.length === 0) return '';

    const sections: string[] = [];
    sections.push('=== RETRIEVED CONTEXT ===');

    // Group by category
    const threadStates = items.filter(i => i.category === 'thread_state');
    const workflowRuns = items.filter(i => i.category === 'workflow_run');
    const decisions = items.filter(i => i.category === 'assistant_decision');

    // Thread state: expose lastWorkflowKey prominently for follow-up resolution
    if (threadStates.length > 0) {
      sections.push('\n[Thread State]');
      for (const item of threadStates) {
        const meta = item.metadata as Record<string, unknown> | null;
        if (meta) {
          if (meta.lastWorkflowKey) sections.push(`lastWorkflowKey: ${meta.lastWorkflowKey}`);
          if (meta.lastWorkflowName) sections.push(`lastWorkflowName: ${meta.lastWorkflowName}`);
          if (meta.lastWorkflowStatus) sections.push(`lastWorkflowStatus: ${meta.lastWorkflowStatus}`);
          if (meta.lastSubject) sections.push(`lastSubject: ${meta.lastSubject}`);
          const recent = meta.recentWorkflows as string[] | undefined;
          if (recent?.length) sections.push(`recentWorkflows: ${recent.join(', ')}`);
        }
      }
    }

    // Workflow runs: concise key-value format
    if (workflowRuns.length > 0) {
      sections.push('\n[Recent Workflow Results]');
      for (const item of workflowRuns) {
        const meta = item.metadata as Record<string, unknown> | null;
        const key = meta?.workflowKey || 'unknown';
        const status = meta?.status || 'unknown';
        sections.push(`--- ${key} (${status}) ---`);
        // Include content but cap at 2000 chars to keep prompt concise
        sections.push(item.content.slice(0, 2000));
      }
    }

    // Decisions: one-line summaries only
    if (decisions.length > 0) {
      sections.push('\n[Recent Decisions]');
      for (const item of decisions.slice(0, 3)) {
        sections.push(`- ${item.summary}`);
      }
    }

    sections.push('=== END CONTEXT ===');
    return sections.join('\n');
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
