/**
 * @fileoverview apps/backend/src/repositories/embedding.repo.ts
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
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { embeddings } from '../db/schema';

export type EmbeddingSourceType = 'workflow' | 'workflow_run' | 'attachment_chunk' | 'chat_summary';

export type UpsertEmbeddingInput = {
  sourceType: EmbeddingSourceType;
  sourceId: string;
  parentId?: string | null;
  userId?: string | null;
  threadId?: string | null;
  content: string;
  contentHash: string;
  vector: number[];
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  metadata?: Record<string, unknown> | null;
};

export const EmbeddingRepo = {
  async upsert(input: UpsertEmbeddingInput) {
    const [row] = await db.insert(embeddings)
      .values({
        id: `emb_${crypto.randomUUID()}`,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        parentId: input.parentId ?? null,
        userId: input.userId ?? null,
        threadId: input.threadId ?? null,
        content: input.content,
        contentHash: input.contentHash,
        embedding: input.vector,
        embeddingProvider: input.embeddingProvider,
        embeddingModel: input.embeddingModel,
        embeddingDimensions: input.embeddingDimensions,
        metadata: input.metadata ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [embeddings.sourceType, embeddings.sourceId, embeddings.contentHash],
        set: {
          parentId: input.parentId ?? null,
          userId: input.userId ?? null,
          threadId: input.threadId ?? null,
          content: input.content,
          embedding: input.vector,
          embeddingProvider: input.embeddingProvider,
          embeddingModel: input.embeddingModel,
          embeddingDimensions: input.embeddingDimensions,
          metadata: input.metadata ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return row;
  },

  async findBySource(sourceType: EmbeddingSourceType, sourceId: string) {
    return db.query.embeddings.findMany({
      where: and(eq(embeddings.sourceType, sourceType), eq(embeddings.sourceId, sourceId)),
      orderBy: (table, { desc }) => [desc(table.updatedAt)],
    });
  },

  async findBySourceIds(sourceType: EmbeddingSourceType, sourceIds: string[]) {
    if (!sourceIds.length) return [];
    return db.query.embeddings.findMany({
      where: and(eq(embeddings.sourceType, sourceType), inArray(embeddings.sourceId, sourceIds)),
    });
  },

  async deleteBySource(sourceType: EmbeddingSourceType, sourceId: string) {
    return db.delete(embeddings)
      .where(and(eq(embeddings.sourceType, sourceType), eq(embeddings.sourceId, sourceId)))
      .returning();
  },

  async deleteBySourceIds(sourceType: EmbeddingSourceType, sourceIds: string[]) {
    if (!sourceIds.length) return [];
    return db.delete(embeddings)
      .where(and(eq(embeddings.sourceType, sourceType), inArray(embeddings.sourceId, sourceIds)))
      .returning();
  },

  async deleteByParentId(sourceType: EmbeddingSourceType, parentId: string) {
    return db.delete(embeddings)
      .where(and(eq(embeddings.sourceType, sourceType), eq(embeddings.parentId, parentId)))
      .returning();
  },
};
