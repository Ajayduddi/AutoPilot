/**
 * @fileoverview apps/backend/src/repositories/recommendation.repo.ts
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
import { dbClient } from '../db';

export type WorkflowRecommendationRow = {
  workflowId: string;
  key: string;
  name: string;
  description: string | null;
  provider: string;
  visibility: string;
  enabled: boolean;
  archived: boolean;
  similarity: number;
};

export type RunRecommendationRow = {
  runId: string;
  workflowId: string;
  workflowKey: string;
  status: string;
  triggerSource: string;
  startedAt: Date;
  finishedAt: Date | null;
  similarity: number;
};

export type DocumentRecommendationRow = {
  chunkId: string;
  attachmentId: string;
  filename: string;
  threadId: string | null;
  chunkIndex: number;
  content: string;
  similarity: number;
};

export const RecommendationRepo = {
  async recommendWorkflows(input: {
    workflowId: string;
    userId: string;
    limit: number;
    minScore: number;
  }): Promise<WorkflowRecommendationRow[]> {
    const rows = await dbClient<WorkflowRecommendationRow[]>`
      with ref as (
        select embedding, embedding_provider, embedding_model
        from embeddings
        where source_type = 'workflow' and source_id = ${input.workflowId}
        order by updated_at desc
        limit 1
      )
      select
        w.id as "workflowId",
        w.key,
        w.name,
        w.description,
        w.provider,
        w.visibility,
        w.enabled,
        w.archived,
        (1 - (e.embedding <=> ref.embedding))::float8 as similarity
      from ref
      join embeddings e
        on e.source_type = 'workflow'
       and e.source_id <> ${input.workflowId}
       and e.embedding_provider = ref.embedding_provider
       and e.embedding_model = ref.embedding_model
      join workflows w on w.id = e.source_id
      where (w.visibility = 'public' or w.owner_user_id = ${input.userId} or w.owner_user_id is null)
        and (1 - (e.embedding <=> ref.embedding)) >= ${input.minScore}
      order by e.embedding <=> ref.embedding asc
      limit ${input.limit}
    `;

    return rows;
  },

  async recommendRuns(input: {
    runId: string;
    userId: string;
    limit: number;
    minScore: number;
    onlyFailures?: boolean;
  }): Promise<RunRecommendationRow[]> {
    const onlyFailures = Boolean(input.onlyFailures);

    const rows = await dbClient<RunRecommendationRow[]>`
      with ref as (
        select embedding, embedding_provider, embedding_model
        from embeddings
        where source_type = 'workflow_run' and source_id = ${input.runId}
        order by updated_at desc
        limit 1
      )
      select
        r.id as "runId",
        r.workflow_id as "workflowId",
        r.workflow_key as "workflowKey",
        r.status,
        r.trigger_source as "triggerSource",
        r.started_at as "startedAt",
        r.finished_at as "finishedAt",
        (1 - (e.embedding <=> ref.embedding))::float8 as similarity
      from ref
      join embeddings e
        on e.source_type = 'workflow_run'
       and e.source_id <> ${input.runId}
       and e.embedding_provider = ref.embedding_provider
       and e.embedding_model = ref.embedding_model
      join workflow_runs r on r.id = e.source_id
      where r.user_id = ${input.userId}
        and (${onlyFailures} = false or r.status = 'failed')
        and (1 - (e.embedding <=> ref.embedding)) >= ${input.minScore}
      order by e.embedding <=> ref.embedding asc
      limit ${input.limit}
    `;

    return rows;
  },

  async recommendDocumentChunks(input: {
    attachmentId: string;
    userId: string;
    limit: number;
    minScore: number;
  }): Promise<DocumentRecommendationRow[]> {
    const rows = await dbClient<DocumentRecommendationRow[]>`
      with ref as (
        select embedding, embedding_provider, embedding_model
        from embeddings
        where source_type = 'attachment_chunk' and parent_id = ${input.attachmentId}
        order by source_id asc
        limit 8
      ),
      scored as (
        select
          e.source_id,
          e.parent_id,
          max(1 - (e.embedding <=> ref.embedding))::float8 as similarity
        from embeddings e
        cross join ref
        where e.source_type = 'attachment_chunk'
          and e.embedding_provider = ref.embedding_provider
          and e.embedding_model = ref.embedding_model
          and e.parent_id <> ${input.attachmentId}
        group by e.source_id, e.parent_id
      )
      select
        c.id as "chunkId",
        c.attachment_id as "attachmentId",
        a.filename,
        a.thread_id as "threadId",
        c.chunk_index as "chunkIndex",
        c.content,
        scored.similarity
      from scored
      join chat_attachment_chunks c on c.id = scored.source_id
      join chat_attachments a on a.id = c.attachment_id
      where c.user_id = ${input.userId}
        and scored.similarity >= ${input.minScore}
      order by scored.similarity desc
      limit ${input.limit}
    `;

    return rows;
  },
};
