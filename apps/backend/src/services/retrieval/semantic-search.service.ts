/**
 * @fileoverview apps/backend/src/services/retrieval/semantic-search.service.ts
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
import { SemanticSearchRepo } from '../../repositories/semantic-search.repo';
import { EmbeddingService } from './embedding.service';
import { getEmbeddingConfig } from '../../config/embedding.config';
import { WorkflowService } from '../workflow/workflow.service';
import { logger } from '../../util/logger';

export type WorkflowSemanticSearchParams = {
  userId: string;
  query: string;
  limit?: number;
  minScore?: number;
  provider?: string;
  enabled?: boolean | string;
  archived?: boolean | string;
  visibility?: 'public' | 'private';
};

export type DocumentSemanticSearchParams = {
  userId: string;
  query: string;
  limit?: number;
  minScore?: number;
  threadId?: string;
  attachmentIds?: string[];
};

export type RunSemanticSearchParams = {
  userId: string;
  query: string;
  limit?: number;
  minScore?: number;
  workflowId?: string;
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'waiting_approval';
  threadId?: string;
  onlyFailures?: boolean | string;
};

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

function parseBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return undefined;
}

function cleanQuery(input: string): string {
  return String(input || '').trim();
}

function clip(text: string, max = 600): string {
  const normalized = String(text || '').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

type QueryEmbeddingCacheEntry = {
  expiresAt: number;
  value: Awaited<ReturnType<typeof EmbeddingService.embedText>>;
};

type SearchResultCacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const QUERY_EMBEDDING_CACHE_TTL_MS = 30_000;
const SEARCH_RESULT_CACHE_TTL_MS = 15_000;
const QUERY_EMBEDDING_CACHE_MAX_ENTRIES = 128;
const SEARCH_RESULT_CACHE_MAX_ENTRIES = 128;
const queryEmbeddingCache = new Map<string, QueryEmbeddingCacheEntry>();
const searchResultCache = new Map<string, SearchResultCacheEntry<unknown>>();

function currentEmbeddingFingerprint() {
  const config = getEmbeddingConfig();
  const activeModel = config.provider === 'bge_local'
    ? config.bgeLocal.model
    : config.provider === 'minilm_local'
      ? config.minilmLocal.model
      : config.gemini.model;
  return {
    provider: config.provider,
    apiProvider: config.apiProvider,
    apiProviderId: config.apiProviderId,
    model: activeModel,
  };
}

function makeCacheKey(prefix: string, payload: unknown) {
  return `${prefix}:${JSON.stringify(payload)}`;
}

function pruneTimedCache<T extends { expiresAt: number }>(
  cache: Map<string, T>,
  maxEntries: number,
  now = Date.now(),
) {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
  if (cache.size <= maxEntries) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const excess = entries.length - maxEntries;
  for (const [key] of entries.slice(0, excess)) {
    cache.delete(key);
  }
}

async function getCachedQueryEmbedding(query: string) {
  const fingerprint = currentEmbeddingFingerprint();
  const cacheKey = makeCacheKey('query-embedding', { query, fingerprint });
  pruneTimedCache(queryEmbeddingCache, QUERY_EMBEDDING_CACHE_MAX_ENTRIES);
  const cached = queryEmbeddingCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await EmbeddingService.embedText(query, { taskType: 'retrieval_query' });
  queryEmbeddingCache.set(cacheKey, {
    expiresAt: now + QUERY_EMBEDDING_CACHE_TTL_MS,
    value,
  });
  pruneTimedCache(queryEmbeddingCache, QUERY_EMBEDDING_CACHE_MAX_ENTRIES, now);
  return value;
}

async function getCachedSearchResult<T>(cacheKey: string, compute: () => Promise<T>): Promise<T> {
  pruneTimedCache(searchResultCache, SEARCH_RESULT_CACHE_MAX_ENTRIES);
  const cached = searchResultCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const value = await compute();
  searchResultCache.set(cacheKey, {
    expiresAt: now + SEARCH_RESULT_CACHE_TTL_MS,
    value,
  });
  pruneTimedCache(searchResultCache, SEARCH_RESULT_CACHE_MAX_ENTRIES, now);
  return value;
}

export class SemanticSearchService {
  static resetCachesForTests() {
    queryEmbeddingCache.clear();
    searchResultCache.clear();
  }

  static async searchWorkflows(input: WorkflowSemanticSearchParams) {
    const query = cleanQuery(input.query);
    if (!query) return { mode: 'semantic', results: [] as any[] };

    const config = getEmbeddingConfig();
    const limit = Math.max(1, Math.min(50, input.limit || config.retrieval.topK));
    const minScore = Math.max(0, Math.min(1, input.minScore ?? config.retrieval.similarityThreshold));
    const cacheKey = makeCacheKey('workflow-search', {
      query,
      userId: input.userId,
      limit,
      minScore,
      provider: input.provider,
      enabled: parseBool(input.enabled),
      archived: parseBool(input.archived),
      visibility: input.visibility,
      fingerprint: currentEmbeddingFingerprint(),
    });

    return getCachedSearchResult(cacheKey, async () => {
      try {
        const embedding = await getCachedQueryEmbedding(query);
        const rows = await SemanticSearchRepo.searchWorkflows({
          userId: input.userId,
          vectorLiteral: toVectorLiteral(embedding.vector),
          embeddingProvider: embedding.modelInfo.provider,
          embeddingModel: embedding.modelInfo.model,
          limit,
          minScore,
          provider: input.provider,
          enabled: parseBool(input.enabled),
          archived: parseBool(input.archived),
          visibility: input.visibility,
        });

        return {
          mode: 'semantic' as const,
          results: rows.map((row) => ({
            ...row,
            similarity: Number(row.similarity || 0),
          })),
        };
      } catch (err) {
        logger.warn({
          scope: 'semantic-search.service',
          message: 'Workflow semantic search degraded to lexical fallback',
          userId: input.userId,
          err,
        });

        const lexical = await WorkflowService.listAccessible(input.userId, {
          search: query,
          provider: input.provider,
          visibility: input.visibility,
          enabled: parseBool(input.enabled),
          archived: parseBool(input.archived),
        });

        return {
          mode: 'lexical_fallback' as const,
          results: lexical.slice(0, limit).map((wf: any) => ({
            workflowId: wf.id,
            key: wf.key,
            name: wf.name,
            description: wf.description || null,
            provider: wf.provider,
            visibility: wf.visibility,
            enabled: wf.enabled,
            archived: wf.archived,
            similarity: 0,
          })),
        };
      }
    });
  }

  static async searchDocuments(input: DocumentSemanticSearchParams) {
    const query = cleanQuery(input.query);
    if (!query) return { mode: 'semantic', results: [] as any[] };

    const config = getEmbeddingConfig();
    const limit = Math.max(1, Math.min(50, input.limit || config.retrieval.topK));
    const minScore = Math.max(0, Math.min(1, input.minScore ?? config.retrieval.similarityThreshold));
    const cacheKey = makeCacheKey('document-search', {
      query,
      userId: input.userId,
      limit,
      minScore,
      threadId: input.threadId,
      attachmentIds: input.attachmentIds || [],
      fingerprint: currentEmbeddingFingerprint(),
    });

    return getCachedSearchResult(cacheKey, async () => {
      try {
        const embedding = await getCachedQueryEmbedding(query);
        const rows = await SemanticSearchRepo.searchDocumentChunks({
          userId: input.userId,
          vectorLiteral: toVectorLiteral(embedding.vector),
          embeddingProvider: embedding.modelInfo.provider,
          embeddingModel: embedding.modelInfo.model,
          limit,
          minScore,
          threadId: input.threadId,
          attachmentIds: input.attachmentIds,
        });

        return {
          mode: 'semantic' as const,
          results: rows.map((row) => ({
            ...row,
            snippet: clip(row.content, 500),
            similarity: Number(row.similarity || 0),
          })),
        };
      } catch (err) {
        logger.warn({
          scope: 'semantic-search.service',
          message: 'Document semantic search unavailable',
          userId: input.userId,
          err,
        });

        return {
          mode: 'unavailable' as const,
          results: [],
        };
      }
    });
  }

  static async searchRuns(input: RunSemanticSearchParams) {
    const query = cleanQuery(input.query);
    if (!query) return { mode: 'semantic', results: [] as any[] };

    const config = getEmbeddingConfig();
    const limit = Math.max(1, Math.min(50, input.limit || config.retrieval.topK));
    const minScore = Math.max(0, Math.min(1, input.minScore ?? config.retrieval.similarityThreshold));
    const cacheKey = makeCacheKey('run-search', {
      query,
      userId: input.userId,
      limit,
      minScore,
      workflowId: input.workflowId,
      status: input.status,
      threadId: input.threadId,
      onlyFailures: parseBool(input.onlyFailures) || false,
      fingerprint: currentEmbeddingFingerprint(),
    });

    return getCachedSearchResult(cacheKey, async () => {
      try {
        const embedding = await getCachedQueryEmbedding(query);
        const rows = await SemanticSearchRepo.searchWorkflowRuns({
          userId: input.userId,
          vectorLiteral: toVectorLiteral(embedding.vector),
          embeddingProvider: embedding.modelInfo.provider,
          embeddingModel: embedding.modelInfo.model,
          limit,
          minScore,
          workflowId: input.workflowId,
          status: input.status,
          threadId: input.threadId,
          onlyFailures: parseBool(input.onlyFailures) || false,
        });

        return {
          mode: 'semantic' as const,
          results: rows.map((row) => ({
            ...row,
            similarity: Number(row.similarity || 0),
          })),
        };
      } catch (err) {
        logger.warn({
          scope: 'semantic-search.service',
          message: 'Run semantic search unavailable',
          userId: input.userId,
          err,
        });

        return {
          mode: 'unavailable' as const,
          results: [],
        };
      }
    });
  }
}
