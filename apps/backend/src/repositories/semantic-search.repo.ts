/**
 * @fileoverview apps/backend/src/repositories/semantic-search.repo.ts
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

type WorkflowSemanticSearchInput = {
  userId: string;
  vectorLiteral: string;
  embeddingProvider: string;
  embeddingModel: string;
  limit: number;
  minScore: number;
  provider?: string;
  enabled?: boolean;
  archived?: boolean;
  visibility?: 'public' | 'private';
};

type DocumentSemanticSearchInput = {
  userId: string;
  vectorLiteral: string;
  embeddingProvider: string;
  embeddingModel: string;
  limit: number;
  minScore: number;
  threadId?: string;
  attachmentIds?: string[];
};

type RunSemanticSearchInput = {
  userId: string;
  vectorLiteral: string;
  embeddingProvider: string;
  embeddingModel: string;
  limit: number;
  minScore: number;
  workflowId?: string;
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'waiting_approval';
  threadId?: string;
  onlyFailures?: boolean;
};

export type WorkflowSemanticSearchRow = {
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

export type DocumentSemanticSearchRow = {
  chunkId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  threadId: string | null;
  chunkIndex: number;
  content: string;
  tokenCount: number | null;
  similarity: number;
};

export type RunSemanticSearchRow = {
  runId: string;
  workflowId: string;
  workflowKey: string;
  status: string;
  triggerSource: string;
  threadId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  similarity: number;
};

function parseMaybeBool(input: unknown): boolean | undefined {
  if (typeof input === 'boolean') return input;
  if (typeof input !== 'string') return undefined;
  const normalized = input.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return undefined;
}

export const SemanticSearchRepo = {
  async searchWorkflows(input: WorkflowSemanticSearchInput): Promise<WorkflowSemanticSearchRow[]> {
    const provider = input.provider?.trim() || null;
    const enabled = parseMaybeBool(input.enabled as unknown);
    const archived = parseMaybeBool(input.archived as unknown);
    const visibility = input.visibility || null;

    const rows = await dbClient<WorkflowSemanticSearchRow[]>`
      select
        w.id as "workflowId",
        w.key,
        w.name,
        w.description,
        w.provider,
        w.visibility,
        w.enabled,
        w.archived,
        (1 - (e.embedding <=> ${input.vectorLiteral}::vector))::float8 as similarity
      from embeddings e
      join workflows w on w.id = e.source_id
      where e.source_type = 'workflow'
        and e.embedding_provider = ${input.embeddingProvider}
        and e.embedding_model = ${input.embeddingModel}
        and (w.visibility = 'public' or w.owner_user_id = ${input.userId} or w.owner_user_id is null)
        and (${provider}::text is null or w.provider = ${provider})
        and (${enabled === undefined ? null : enabled}::boolean is null or w.enabled = ${enabled === undefined ? null : enabled})
        and (${archived === undefined ? null : archived}::boolean is null or w.archived = ${archived === undefined ? null : archived})
        and (${visibility}::text is null or w.visibility = ${visibility})
        and (1 - (e.embedding <=> ${input.vectorLiteral}::vector)) >= ${input.minScore}
      order by e.embedding <=> ${input.vectorLiteral}::vector asc
      limit ${input.limit}
    `;

    return rows;
  },

  async searchDocumentChunks(input: DocumentSemanticSearchInput): Promise<DocumentSemanticSearchRow[]> {
    const attachmentIds = (input.attachmentIds || []).filter(Boolean);
    const hasAttachmentFilter = attachmentIds.length > 0;

    const rows = await dbClient<DocumentSemanticSearchRow[]>`
      select
        c.id as "chunkId",
        c.attachment_id as "attachmentId",
        a.filename,
        a.mime_type as "mimeType",
        a.thread_id as "threadId",
        c.chunk_index as "chunkIndex",
        c.content,
        c.token_count as "tokenCount",
        (1 - (e.embedding <=> ${input.vectorLiteral}::vector))::float8 as similarity
      from embeddings e
      join chat_attachment_chunks c on c.id = e.source_id
      join chat_attachments a on a.id = c.attachment_id
      where e.source_type = 'attachment_chunk'
        and e.embedding_provider = ${input.embeddingProvider}
        and e.embedding_model = ${input.embeddingModel}
        and c.user_id = ${input.userId}
        and (${input.threadId || null}::text is null or a.thread_id = ${input.threadId || null})
        and (${hasAttachmentFilter} = false or c.attachment_id = any(${attachmentIds}::text[]))
        and (1 - (e.embedding <=> ${input.vectorLiteral}::vector)) >= ${input.minScore}
      order by e.embedding <=> ${input.vectorLiteral}::vector asc
      limit ${input.limit}
    `;

    return rows;
  },

  async searchWorkflowRuns(input: RunSemanticSearchInput): Promise<RunSemanticSearchRow[]> {
    const onlyFailures = Boolean(input.onlyFailures);

    const rows = await dbClient<RunSemanticSearchRow[]>`
      select
        r.id as "runId",
        r.workflow_id as "workflowId",
        r.workflow_key as "workflowKey",
        r.status,
        r.trigger_source as "triggerSource",
        r.thread_id as "threadId",
        r.started_at as "startedAt",
        r.finished_at as "finishedAt",
        (1 - (e.embedding <=> ${input.vectorLiteral}::vector))::float8 as similarity
      from embeddings e
      join workflow_runs r on r.id = e.source_id
      where e.source_type = 'workflow_run'
        and e.embedding_provider = ${input.embeddingProvider}
        and e.embedding_model = ${input.embeddingModel}
        and r.user_id = ${input.userId}
        and (${input.workflowId || null}::text is null or r.workflow_id = ${input.workflowId || null})
        and (${input.status || null}::text is null or r.status = ${input.status || null})
        and (${input.threadId || null}::text is null or r.thread_id = ${input.threadId || null})
        and (${onlyFailures} = false or r.status = 'failed')
        and (1 - (e.embedding <=> ${input.vectorLiteral}::vector)) >= ${input.minScore}
      order by e.embedding <=> ${input.vectorLiteral}::vector asc
      limit ${input.limit}
    `;

    return rows;
  },
};
