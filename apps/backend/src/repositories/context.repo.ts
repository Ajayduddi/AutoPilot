import { eq, and, desc, sql, SQL } from 'drizzle-orm';
import { db } from '../db';
import { contextMemory } from '../db/schema';

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

export type ContextCategory = 'workflow_run' | 'assistant_decision' | 'thread_state';

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

// ─────────────────────────────────────────────────────────────
//  Repository
// ─────────────────────────────────────────────────────────────

export const ContextRepo = {
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
};
