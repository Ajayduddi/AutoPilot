/**
 * @fileoverview services/context.service.
 *
 * High-level purpose:
 * Application/business orchestration services for domain workflows and integrations.
 *
 * Key Features (and trade-offs):
 * - Encapsulates domain logic behind testable service APIs.
 * - Coordinates provider calls, repository access, and policy checks.
 * - Provides reusable units consumed by routes and background flows.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Keep side effects localized and explicit in service methods.
 * 3. Prefer dependency reuse over duplicating orchestration logic.
 * 4. Validate behavior with targeted service tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { ContextRepo, type ContextItem, type ContextCategory } from '../../repositories/context.repo';
import { contextConfig } from '../../config/context.config';
import { EmbeddingIndexService } from '../retrieval/embedding-index.service';
import { EmbeddingRepo } from '../../repositories/embedding.repo';
import { EmbeddingService } from '../retrieval/embedding.service';
import { getEmbeddingConfig } from '../../config/embedding.config';
import { logger } from '../../util/logger';
import { incrementCounter, observeHistogram } from '../../util/metrics';
import { ContextWorkflowCacheService } from './context-workflow-cache.service';
import { ContextInsightsService } from './context-insights.service';
import type {
  ThreadMemoryInsight,
  ThreadMemoryInsightOptions,
  ThreadMemoryInsightSummary,
} from './context.types';

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

export interface IndexChatSummaryParams {
  threadId: string;
  userId?: string;
  content: string;
  summary?: string;
  summaryKind: 'preference' | 'entity' | 'milestone' | 'unresolved_task' | 'recap';
  importance?: 'low' | 'medium' | 'high';
  entityKeys?: string[];
  sourceMessageIds?: string[];
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

export interface HybridThreadContextOptions {
  userId?: string;
  query?: string;
  exactLimit?: number;
  semanticLimit?: number;
  categories?: ContextCategory[];
  includeSemanticWorkflowRuns?: boolean;
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

const THREAD_MEMORY_SEARCH_CACHE_TTL_MS = 15_000;
const THREAD_MEMORY_SEARCH_CACHE_MAX_ENTRIES = 128;
const semanticThreadMemoryCache = new Map<string, {
  expiresAt: number;
  value: Array<ContextItem & { similarity: number; sourceType: 'workflow_run' | 'chat_summary' }>;
}>();
const semanticThreadMemoryInflight = new Map<string, Promise<Array<ContextItem & { similarity: number; sourceType: 'workflow_run' | 'chat_summary' }>>>();

// ─────────────────────────────────────────────────────────────
//  Logging helpers
// ─────────────────────────────────────────────────────────────

function sanitizeLogArgs(args: unknown[]): Record<string, unknown> | undefined {
  if (!args.length) return undefined;
  const errors = args
    .filter((value) => value instanceof Error)
    .map((error) => ({ name: error.name, message: error.message }))
    .slice(0, 3);
  return {
    argCount: args.length,
    ...(errors.length ? { errors } : {}),
  };
}

function logDebug(msg: string, ...args: unknown[]) {
  if (contextConfig.debug) {
    logger.debug({ scope: 'context', message: msg, ...(sanitizeLogArgs(args) ? { details: sanitizeLogArgs(args) } : {}) });
  }
}

function logInfo(msg: string, ...args: unknown[]) {
  logger.info({ scope: 'context', message: msg, ...(sanitizeLogArgs(args) ? { details: sanitizeLogArgs(args) } : {}) });
}

function logError(msg: string, ...args: unknown[]) {
  logger.error({ scope: 'context', message: msg, ...(sanitizeLogArgs(args) ? { details: sanitizeLogArgs(args) } : {}) });
}

function pruneSemanticThreadMemoryCache(now = Date.now()) {
  for (const [key, entry] of semanticThreadMemoryCache.entries()) {
    if (entry.expiresAt <= now) {
      semanticThreadMemoryCache.delete(key);
    }
  }
  if (semanticThreadMemoryCache.size <= THREAD_MEMORY_SEARCH_CACHE_MAX_ENTRIES) return;
  const entries = [...semanticThreadMemoryCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const excess = entries.length - THREAD_MEMORY_SEARCH_CACHE_MAX_ENTRIES;
  for (const [key] of entries.slice(0, excess)) {
    semanticThreadMemoryCache.delete(key);
  }
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

function extractSummaryKeywords(text: string, limit = 6): string[] {
  const stopWords = new Set(['that', 'this', 'with', 'from', 'have', 'your', 'about', 'there', 'their', 'what', 'when', 'where', 'which', 'would', 'could', 'should', 'please', 'thanks']);
  const values = tokenize(text)
    .filter((token) => !stopWords.has(token))
    .slice(0, limit);
  return [...new Set(values)];
}

function toResultCountBucket(count: number): string {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 3) return '2_3';
  if (count <= 5) return '4_5';
  return '6_plus';
}

function dedupeContextItems(items: ContextItem[]): ContextItem[] {
  const seen = new Set<string>();
  const results: ContextItem[] = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    results.push(item);
  }
  return results;
}

function shouldUseSemanticMemory(query: string): boolean {
  const normalized = normalizeText(query);
  if (!normalized || normalized.length < 12) return false;
  if (/\b(run it again|rerun|retry|re-trigger|retry workflow|show previous result|last run|latest run|workflow status)\b/.test(normalized)) {
    return false;
  }
  if (/\b(similar|related|earlier|before|history|historical|remember|recall|discussed|talked|mentioned|preference|prefer|client|project|renewal|invoice|resume|contract)\b/.test(normalized)) {
    return true;
  }
  return normalized.split(/\s+/).length >= 6;
}

function deriveChatSummaryCandidates(input: {
  userMessage: string;
  assistantReply?: string;
}): Array<Omit<IndexChatSummaryParams, 'threadId' | 'userId'>> {
  const candidates: Array<Omit<IndexChatSummaryParams, 'threadId' | 'userId'>> = [];
  const userMessage = String(input.userMessage || '').trim();
  const assistantReply = String(input.assistantReply || '').trim();
  const normalized = normalizeText(userMessage);
  if (!userMessage || userMessage.length < 12) return candidates;

  if (/\b(prefer|preference|please use|always use|remember that|call me|my name is|timezone is|i like|i want concise|i want detailed|don't use)\b/.test(normalized)) {
    candidates.push({
      content: truncate(`User preference noted: ${userMessage}`, contextConfig.contentMaxLength),
      summary: truncate(`Preference: ${userMessage}`, contextConfig.summaryMaxLength),
      summaryKind: 'preference',
      importance: 'high',
      entityKeys: extractSummaryKeywords(userMessage),
      sourceMessageIds: [],
    });
  }

  if (/\b(project|client|account|company|customer|renewal|invoice|contract|resume|candidate)\b/.test(normalized)) {
    candidates.push({
      content: truncate(
        [userMessage, assistantReply ? `Assistant context: ${assistantReply}` : ''].filter(Boolean).join('\n'),
        contextConfig.contentMaxLength,
      ),
      summary: truncate(`Thread entity context: ${userMessage}`, contextConfig.summaryMaxLength),
      summaryKind: 'entity',
      importance: 'medium',
      entityKeys: extractSummaryKeywords(userMessage),
      sourceMessageIds: [],
    });
  }

  if (/\b(need to|todo|follow up|remind me|pending|open task|next step)\b/.test(normalized)) {
    candidates.push({
      content: truncate(`Open task from conversation: ${userMessage}`, contextConfig.contentMaxLength),
      summary: truncate(`Open task: ${userMessage}`, contextConfig.summaryMaxLength),
      summaryKind: 'unresolved_task',
      importance: 'medium',
      entityKeys: extractSummaryKeywords(userMessage),
      sourceMessageIds: [],
    });
  }

  return candidates;
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
  for (const [, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.length > 0 && value.length < 200) {
      entities.push(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Go one level deep
      for (const [, subVal] of Object.entries(value as Record<string, unknown>)) {
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
  static resetSemanticThreadMemoryCacheForTests() {
    semanticThreadMemoryCache.clear();
    semanticThreadMemoryInflight.clear();
  }

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
        id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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
        id: existing?.id || crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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

  static async indexChatSummary(params: IndexChatSummaryParams): Promise<void> {
    if (!contextConfig.enabled) return;

    const content = truncate(String(params.content || '').trim(), contextConfig.contentMaxLength);
    if (!content || content.length < 20) return;

    const metadata: Record<string, unknown> = {
      summaryKind: params.summaryKind,
      importance: params.importance || 'medium',
      entityKeys: [...new Set((params.entityKeys || []).map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 10),
      sourceMessageIds: [...new Set((params.sourceMessageIds || []).map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 10),
      supersedesContextId: null,
    };

    try {
      const existing = await ContextRepo.findLatestChatSummary(
        params.threadId,
        params.summaryKind,
        Array.isArray(metadata.entityKeys) ? metadata.entityKeys as string[] : [],
      );

      let contextItem: ContextItem;
      if (existing) {
        metadata.supersedesContextId = existing.id;
        await ContextRepo.updateById(existing.id, {
          content,
          summary: truncate(params.summary || content, contextConfig.summaryMaxLength),
          metadata: {
            ...(existing.metadata || {}),
            ...metadata,
          },
        });
        contextItem = {
          ...existing,
          content,
          summary: truncate(params.summary || content, contextConfig.summaryMaxLength),
          metadata: {
            ...(existing.metadata || {}),
            ...metadata,
          },
        };
      } else {
        contextItem = await ContextRepo.create({
          id: crypto.randomUUID(),
          threadId: params.threadId,
          userId: params.userId,
          category: 'chat_summary',
          workflowRunId: params.workflowRunId,
          workflowId: params.workflowId,
          content,
          summary: truncate(params.summary || content, contextConfig.summaryMaxLength),
          metadata,
          expiresAt: computeExpiry(),
        });
      }

      await EmbeddingIndexService.indexChatSummary({
        contextId: contextItem.id,
        threadId: params.threadId,
        userId: params.userId ?? undefined,
        content,
        summary: contextItem.summary || undefined,
        metadata: contextItem.metadata || metadata,
      });
    } catch (err) {
      logError('Failed to index chat summary:', err);
    }
  }

  static async maybeIndexChatSummaryFromTurn(input: {
    threadId: string;
    userId?: string;
    userMessage: string;
    assistantReply?: string;
    sourceMessageIds?: string[];
  }): Promise<void> {
    const candidates = deriveChatSummaryCandidates(input);
    for (const candidate of candidates) {
      await this.indexChatSummary({
        threadId: input.threadId,
        userId: input.userId,
        ...candidate,
        sourceMessageIds: input.sourceMessageIds || [],
      });
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

  static async searchSemanticThreadMemory(input: {
    threadId: string;
    userId?: string;
    query: string;
    limit?: number;
    minScore?: number;
    includeWorkflowRuns?: boolean;
  }): Promise<Array<ContextItem & { similarity: number; sourceType: 'workflow_run' | 'chat_summary' }>> {
    if (!contextConfig.enabled) return [];

    const query = String(input.query || '').trim();
    if (!query) return [];

    try {
      const cfg = getEmbeddingConfig();
      const limit = Math.max(1, input.limit ?? Math.min(4, cfg.retrieval.topK));
      const minScore = Math.max(0, Math.min(1, input.minScore ?? cfg.retrieval.similarityThreshold));
      const fingerprint = JSON.stringify({
        provider: cfg.provider,
        apiProvider: cfg.apiProvider,
        apiProviderId: cfg.apiProviderId,
        model: cfg.provider === 'bge_local'
          ? cfg.bgeLocal.model
          : cfg.provider === 'minilm_local'
            ? cfg.minilmLocal.model
            : cfg.gemini.model,
      });
      const cacheKey = JSON.stringify({
        threadId: input.threadId,
        userId: input.userId || '',
        query,
        limit,
        minScore,
        includeWorkflowRuns: input.includeWorkflowRuns ?? true,
        fingerprint,
      });
      const now = Date.now();
      pruneSemanticThreadMemoryCache(now);
      const cached = semanticThreadMemoryCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        incrementCounter('autopilot_context_semantic_memory_cache_total', {
          outcome: 'hit',
        });
        return cached.value;
      }

      const inflight = semanticThreadMemoryInflight.get(cacheKey);
      if (inflight) {
        incrementCounter('autopilot_context_semantic_memory_cache_total', {
          outcome: 'shared',
        });
        return await inflight;
      }

      incrementCounter('autopilot_context_semantic_memory_cache_total', {
        outcome: 'miss',
      });
      const startedAt = performance.now();
      const lookupPromise = (async () => {
        const embedding = await EmbeddingService.embedText(query, { taskType: 'retrieval_query' });
        const rows = await ContextRepo.searchSemanticInThread({
          threadId: input.threadId,
          userId: input.userId,
          vectorLiteral: `[${embedding.vector.join(',')}]`,
          embeddingProvider: embedding.modelInfo.provider,
          embeddingModel: embedding.modelInfo.model,
          limit,
          minScore,
          includeWorkflowRuns: input.includeWorkflowRuns ?? true,
        });
        semanticThreadMemoryCache.set(cacheKey, {
          expiresAt: Date.now() + THREAD_MEMORY_SEARCH_CACHE_TTL_MS,
          value: rows,
        });
        pruneSemanticThreadMemoryCache();
        observeHistogram('autopilot_context_semantic_memory_search_latency_ms', performance.now() - startedAt, {
          includeWorkflowRuns: input.includeWorkflowRuns ?? true,
          resultBucket: toResultCountBucket(rows.length),
        });
        return rows;
      })();
      semanticThreadMemoryInflight.set(cacheKey, lookupPromise);
      try {
        return await lookupPromise;
      } finally {
        semanticThreadMemoryInflight.delete(cacheKey);
      }
    } catch (err) {
      incrementCounter('autopilot_context_semantic_memory_cache_total', {
        outcome: 'error',
      });
      logError('Failed to search semantic thread memory:', err);
      return [];
    }
  }

  static async getHybridThreadContext(
    threadId: string,
    options?: HybridThreadContextOptions,
  ): Promise<ContextItem[]> {
    const exactItems = await this.getThreadContext(threadId, {
      limit: options?.exactLimit ?? contextConfig.maxRetrieval,
      categories: options?.categories,
    });

    const query = String(options?.query || '').trim();
    if (!shouldUseSemanticMemory(query)) {
      return exactItems;
    }

    const semanticItems = await this.searchSemanticThreadMemory({
      threadId,
      userId: options?.userId,
      query,
      limit: options?.semanticLimit ?? 3,
      includeWorkflowRuns: options?.includeSemanticWorkflowRuns ?? true,
    });

    return dedupeContextItems([...exactItems, ...semanticItems]);
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
        const chatSummaries = items.filter(i => i.category === 'chat_summary');
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

    if (chatSummaries.length > 0) {
      if (!pushWithinBudget('\n[Long-term Thread Memory]', { itemCapTokens: 128 })) return sections.join('\n');
      for (const item of chatSummaries.slice(0, 4)) {
        const meta = (item.metadata as Record<string, unknown> | null) || {};
        const summaryKind = typeof meta.summaryKind === 'string' ? meta.summaryKind : 'memory';
        const importance = typeof meta.importance === 'string' ? meta.importance : 'medium';
        const headline = item.summary || item.content;
        if (!pushWithinBudget(`- ${summaryKind} (${importance}): ${headline}`, { itemCapTokens: 140 })) return sections.join('\n');
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
    return await ContextWorkflowCacheService.persistWorkflowRunSnapshot(input);
  }

  static async loadCompleteWorkflowCache(item: ContextItem): Promise<string> {
    return await ContextWorkflowCacheService.loadCompleteWorkflowCache(item);
  }

  static async extractWorkflowRunFields(
    item: ContextItem,
    fields: string[],
  ): Promise<{ values: Record<string, unknown>; missing: string[]; source: 'normalized_output' | 'snapshot_text' | 'context_content' }> {
    return await ContextWorkflowCacheService.extractWorkflowRunFields(item, fields);
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

  static async listThreadMemoryInsights(threadId: string): Promise<ThreadMemoryInsight[]> {
    return this.listThreadMemoryInsightsWithOptions(threadId, {});
  }

  static async listThreadMemoryInsightsWithOptions(
    threadId: string,
    options: ThreadMemoryInsightOptions = {},
  ): Promise<ThreadMemoryInsight[]> {
    return (await this.listThreadMemoryInsightsSummary(threadId, options)).items;
  }

  static async listThreadMemoryInsightsSummary(
    threadId: string,
    options: ThreadMemoryInsightOptions = {},
  ): Promise<ThreadMemoryInsightSummary> {
    return await ContextInsightsService.listThreadMemoryInsightsSummary(
      threadId,
      options,
      (currentThreadId, retrievalOptions) => this.getThreadContext(currentThreadId, retrievalOptions),
    );
  }

  /**
   * Delete all context for a thread (cascade on thread deletion).
   */
  static async deleteThreadContext(threadId: string): Promise<void> {
    try {
      const chatSummaries = await ContextRepo.getByThreadAndCategory(threadId, 'chat_summary', 100);
      if (chatSummaries.length) {
        await EmbeddingRepo.deleteBySourceIds('chat_summary', chatSummaries.map((item) => item.id));
      }
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
