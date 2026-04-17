/**
 * @fileoverview repositories/context.repo.
 *
 * High-level purpose:
 * Data access repository layer for persistence operations and query composition.
 *
 * Key Features (and trade-offs):
 * - Typed CRUD/query helpers over Drizzle and database schema.
 * - Centralized data filtering, sorting, and pagination primitives.
 * - Keeps SQL/ORM concerns isolated from route and service layers.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Use repositories from services only, not directly from routes.
 * 3. Keep repository methods deterministic and side-effect scoped.
 * 4. Run database-related tests when query behavior changes.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { dbClient } from '../db';
import { contextMemory } from '../db/schema';

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

/** Supported categories for persisted context memory records. */
export type ContextCategory = 'workflow_run' | 'assistant_decision' | 'thread_state' | 'audit_event' | 'chat_summary';

/**
 * CreateContextItemInput type contract.
 */
export interface CreateContextItemInput {
  id: string;
  threadId?: string;
  userId?: string;
  category: ContextCategory;
  workflowRunId?: string;
  workflowId?: string;
  content: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
}

/**
 * ContextItem type contract.
 */
export interface ContextItem {
  id: string;
  threadId: string | null;
  userId: string | null;
  category: ContextCategory;
  workflowRunId: string | null;
  workflowId: string | null;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface SemanticContextMatch extends ContextItem {
  similarity: number;
  sourceType: 'workflow_run' | 'chat_summary';
}

export type ContextCategoryCounts = Record<ContextCategory, number>;

// ─────────────────────────────────────────────────────────────
//  Repository
// ─────────────────────────────────────────────────────────────

/**
 * Repository for CRUD/search operations on context memory records.
 *
 * @example
 * ```typescript
 * const items = await ContextRepo.getByThread(threadId, 5);
 * ```
 */
export const ContextRepo = {
  /** Inserts a new context memory row. */
  async create(data: CreateContextItemInput): Promise<ContextItem> {
    const [item] = await db.insert(contextMemory).values(data).returning();
    return item as unknown as ContextItem;
  },

  /**
   * Upsert by threadId + category (used for thread_state — only one per thread).
   */
  async upsertThreadState(data: CreateContextItemInput): Promise<ContextItem> {
    const existing = await db.query.contextMemory.findFirst({
      where: and(
        eq(contextMemory.threadId, data.threadId!),
        eq(contextMemory.category, 'thread_state'),
      ),
    });

    if (existing) {
      const [updated] = await db.update(contextMemory)
        .set({
          content: data.content,
          summary: data.summary,
          metadata: data.metadata,
          expiresAt: data.expiresAt,
        })
        .where(eq(contextMemory.id, existing.id))
        .returning();
      return updated as unknown as ContextItem;
    }

    return this.create(data);
  },

  /**
   * Update content and metadata for an existing context item by ID.
   */
  async updateById(
    id: string,
    updates: { content?: string; summary?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    await db.update(contextMemory)
      .set(updates)
      .where(eq(contextMemory.id, id));
  },

  /**
   * Get context items for a thread, ordered by most recent first.
   */
  async getByThread(threadId: string, limit = 10): Promise<ContextItem[]> {
    const items = await db.query.contextMemory.findMany({
      where: eq(contextMemory.threadId, threadId),
      orderBy: desc(contextMemory.createdAt),
      limit,
    });
    return items as unknown as ContextItem[];
  },

  /**
   * Get context items for a thread filtered by category.
   */
  async getByThreadAndCategory(
    threadId: string,
    category: ContextCategory,
    limit = 10,
  ): Promise<ContextItem[]> {
    const items = await db.query.contextMemory.findMany({
      where: and(
        eq(contextMemory.threadId, threadId),
        eq(contextMemory.category, category),
      ),
      orderBy: desc(contextMemory.createdAt),
      limit,
    });
    return items as unknown as ContextItem[];
  },

  async getThreadCategoryCounts(threadId: string): Promise<ContextCategoryCounts> {
    const rows = await db
      .select({
        category: contextMemory.category,
        count: sql<number>`count(*)::int`,
      })
      .from(contextMemory)
      .where(eq(contextMemory.threadId, threadId))
      .groupBy(contextMemory.category);

    const counts: ContextCategoryCounts = {
      workflow_run: 0,
      assistant_decision: 0,
      thread_state: 0,
      audit_event: 0,
      chat_summary: 0,
    };
    for (const row of rows) {
      const key = String(row.category || '') as ContextCategory;
      if (key in counts) counts[key] = Number(row.count || 0);
    }
    return counts;
  },

  async findLatestChatSummary(
    threadId: string,
    summaryKind: string,
    entityKeys: string[] = [],
  ): Promise<ContextItem | null> {
    const items = await db.query.contextMemory.findMany({
      where: and(
        eq(contextMemory.threadId, threadId),
        eq(contextMemory.category, 'chat_summary'),
      ),
      orderBy: desc(contextMemory.createdAt),
      limit: 20,
    });

    const normalizedKind = summaryKind.trim().toLowerCase();
    const normalizedEntityKeys = entityKeys.map((value) => value.trim().toLowerCase()).filter(Boolean);
    const match = items.find((item) => {
      const metadata = (item.metadata as Record<string, unknown> | null) || {};
      const kind = String(metadata.summaryKind || '').trim().toLowerCase();
      if (kind !== normalizedKind) return false;
      if (!normalizedEntityKeys.length) return true;
      const currentEntityKeys = Array.isArray(metadata.entityKeys)
        ? metadata.entityKeys.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
        : [];
      return normalizedEntityKeys.some((value) => currentEntityKeys.includes(value));
    });

    return (match as unknown as ContextItem) ?? null;
  },

  /**
   * Get the single thread_state item for a thread (there's at most one).
   */
  async getThreadState(threadId: string): Promise<ContextItem | null> {
    const item = await db.query.contextMemory.findFirst({
      where: and(
        eq(contextMemory.threadId, threadId),
        eq(contextMemory.category, 'thread_state'),
      ),
    });
    return (item as unknown as ContextItem) ?? null;
  },

  /**
   * Get the most recent workflow_run context item for a thread.
   */
  async getLastWorkflowRun(threadId: string): Promise<ContextItem | null> {
    const item = await db.query.contextMemory.findFirst({
      where: and(
        eq(contextMemory.threadId, threadId),
        eq(contextMemory.category, 'workflow_run'),
      ),
      orderBy: desc(contextMemory.createdAt),
    });
    return (item as unknown as ContextItem) ?? null;
  },

  /**
   * Simple text search across content and summary for a thread.
   * Uses PostgreSQL ILIKE for Stage 1; can upgrade to tsvector FTS later.
   */
  async searchInThread(
    threadId: string,
    query: string,
    limit = 5,
  ): Promise<ContextItem[]> {
    const pattern = `%${query}%`;
    const items = await db.query.contextMemory.findMany({
      where: and(
        eq(contextMemory.threadId, threadId),
        sql`(${contextMemory.content} ILIKE ${pattern} OR ${contextMemory.summary} ILIKE ${pattern})`,
      ),
      orderBy: desc(contextMemory.createdAt),
      limit,
    });
    return items as unknown as ContextItem[];
  },

  async searchSemanticInThread(input: {
    threadId: string;
    userId?: string;
    vectorLiteral: string;
    embeddingProvider: string;
    embeddingModel: string;
    limit: number;
    minScore: number;
    includeWorkflowRuns?: boolean;
  }): Promise<SemanticContextMatch[]> {
    const rows = await dbClient<Array<{
      id: string;
      threadId: string | null;
      userId: string | null;
      category: ContextCategory;
      workflowRunId: string | null;
      workflowId: string | null;
      content: string;
      summary: string | null;
      metadata: Record<string, unknown> | null;
      createdAt: Date;
      expiresAt: Date | null;
      similarity: number;
      sourceType: 'workflow_run' | 'chat_summary';
    }>>`
      select
        c.id as "id",
        c.thread_id as "threadId",
        c.user_id as "userId",
        c.category as "category",
        c.workflow_run_id as "workflowRunId",
        c.workflow_id as "workflowId",
        c.content as "content",
        c.summary as "summary",
        c.metadata as "metadata",
        c.created_at as "createdAt",
        c.expires_at as "expiresAt",
        (1 - (e.embedding <=> ${input.vectorLiteral}::vector))::float8 as "similarity",
        e.source_type as "sourceType"
      from embeddings e
      join context_memory c on (
        (e.source_type = 'chat_summary' and c.id = e.source_id and c.category = 'chat_summary')
        or
        (
          ${Boolean(input.includeWorkflowRuns)} = true
          and e.source_type = 'workflow_run'
          and c.workflow_run_id = e.source_id
          and c.category = 'workflow_run'
        )
      )
      where c.thread_id = ${input.threadId}
        and (${input.userId || null}::text is null or c.user_id = ${input.userId || null} or c.user_id is null)
        and e.embedding_provider = ${input.embeddingProvider}
        and e.embedding_model = ${input.embeddingModel}
        and (1 - (e.embedding <=> ${input.vectorLiteral}::vector)) >= ${input.minScore}
      order by e.embedding <=> ${input.vectorLiteral}::vector asc
      limit ${input.limit}
    `;

    return rows as SemanticContextMatch[];
  },

  /**
   * Delete expired context items.
   */
  async deleteExpired(): Promise<number> {
    const result = await db.delete(contextMemory)
      .where(sql`${contextMemory.expiresAt} IS NOT NULL AND ${contextMemory.expiresAt} < NOW()`)
      .returning();
    return result.length;
  },

  /**
   * Delete all context items for a thread (used when thread is deleted).
   */
  async deleteByThread(threadId: string): Promise<number> {
    const result = await db.delete(contextMemory)
      .where(eq(contextMemory.threadId, threadId))
      .returning();
    return result.length;
  },

  async deleteChatSummariesByThread(threadId: string): Promise<ContextItem[]> {
    const result = await db.delete(contextMemory)
      .where(and(eq(contextMemory.threadId, threadId), eq(contextMemory.category, 'chat_summary')))
      .returning();
    return result as unknown as ContextItem[];
  },
};
