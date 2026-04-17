/**
 * @fileoverview apps/backend/src/services/retrieval/embedding-index.service.ts
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
import { EmbeddingRepo, type EmbeddingSourceType } from '../../repositories/embedding.repo';
import { EmbeddingService, type EmbedTextOptions } from './embedding.service';
import { logger } from '../../util/logger';

export type IndexEmbeddingInput = {
  sourceType: EmbeddingSourceType;
  sourceId: string;
  parentId?: string | null;
  userId?: string | null;
  threadId?: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
  embedOptions?: EmbedTextOptions;
};

export type IndexWorkflowEmbeddingInput = {
  workflowId: string;
  userId?: string | null;
  key: string;
  name: string;
  description?: string | null;
  provider: string;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

export type IndexWorkflowRunEmbeddingInput = {
  runId: string;
  workflowId: string;
  workflowKey: string;
  workflowName?: string;
  provider: string;
  status: string;
  triggerSource?: string;
  userId?: string | null;
  threadId?: string | null;
  resultSummary?: string | null;
  resultData?: Record<string, unknown> | null;
  errorSummary?: string | null;
  executionNotes?: string[];
  metadata?: Record<string, unknown> | null;
};

export type AttachmentChunkEmbeddingInput = {
  id: string;
  chunkIndex: number;
  content: string;
  tokenCount?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type IndexChatSummaryEmbeddingInput = {
  contextId: string;
  threadId: string;
  userId?: string | null;
  content: string;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
};

function truncate(text: string, max = 2_000): string {
  const normalized = String(text || '').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function stripSensitiveMetadata(value: unknown): unknown {
  const sensitive = ['api_key', 'apikey', 'token', 'secret', 'password', 'credential', 'authorization', 'auth'];
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitiveMetadata(item));
  }
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const keyNormalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (sensitive.some((needle) => keyNormalized.includes(needle))) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = stripSensitiveMetadata(child);
  }
  return out;
}

function summarizeMetadata(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata) return '';
  const safe = stripSensitiveMetadata(metadata);
  try {
    return truncate(JSON.stringify(safe), 800);
  } catch {
    return '';
  }
}

function summarizeResultData(data: Record<string, unknown> | null | undefined): string {
  if (!data) return '';
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data).slice(0, 20)) {
    if (typeof value === 'string') {
      lines.push(`${key}: ${truncate(value, 180)}`);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${String(value)}`);
      continue;
    }
    if (Array.isArray(value)) {
      lines.push(`${key}: array(${value.length})`);
      continue;
    }
    if (value && typeof value === 'object') {
      lines.push(`${key}: object(${Object.keys(value as Record<string, unknown>).slice(0, 8).join(',')})`);
    }
  }
  return truncate(lines.join('\n'), 1200);
}

export class EmbeddingIndexService {
  static shouldReembed(existingContentHash: string | null | undefined, nextContent: string): boolean {
    const nextHash = EmbeddingService.hashContent(nextContent);
    return !existingContentHash || existingContentHash !== nextHash;
  }

  static async upsertSourceEmbedding(input: IndexEmbeddingInput) {
    const contentHash = EmbeddingService.hashContent(input.content);

    const existingRows = await EmbeddingRepo.findBySource(input.sourceType, input.sourceId);
    const existing = existingRows[0];
    if (existing?.contentHash === contentHash) {
      return {
        changed: false,
        embedding: existing,
      };
    }

    // Maintain a single active embedding payload per source.
    await EmbeddingRepo.deleteBySource(input.sourceType, input.sourceId);

    const embedding = await EmbeddingService.embedText(input.content, {
      taskType: 'retrieval_document',
      ...(input.embedOptions || {}),
    });

    const row = await EmbeddingRepo.upsert({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      parentId: input.parentId ?? null,
      userId: input.userId ?? null,
      threadId: input.threadId ?? null,
      content: input.content,
      contentHash,
      vector: embedding.vector,
      embeddingProvider: embedding.modelInfo.provider,
      embeddingModel: embedding.modelInfo.model,
      embeddingDimensions: embedding.modelInfo.dimensions,
      metadata: input.metadata ?? null,
    });

    return {
      changed: true,
      embedding: row,
    };
  }

  static buildWorkflowEmbeddingContent(input: IndexWorkflowEmbeddingInput): string {
    const parts = [
      `Workflow Name: ${normalizeText(input.name)}`,
      `Workflow Key: ${normalizeText(input.key)}`,
      `Description: ${normalizeText(input.description || '')}`,
      `Provider: ${normalizeText(input.provider)}`,
      `Tags: ${(input.tags || []).filter(Boolean).join(', ')}`,
      `Metadata: ${summarizeMetadata(input.metadata || null)}`,
    ].filter((item) => !!item && !item.endsWith(': '));

    return truncate(parts.join('\n'), 3_200);
  }

  static async indexWorkflowDefinition(input: IndexWorkflowEmbeddingInput) {
    const content = this.buildWorkflowEmbeddingContent(input);
    return this.upsertSourceEmbedding({
      sourceType: 'workflow',
      sourceId: input.workflowId,
      userId: input.userId ?? null,
      content,
      metadata: {
        key: input.key,
        name: input.name,
        provider: input.provider,
        tags: input.tags || [],
      },
      embedOptions: {
        taskType: 'retrieval_document',
        title: input.name,
      },
    });
  }

  static buildWorkflowRunEmbeddingContent(input: IndexWorkflowRunEmbeddingInput): string {
    const notes = (input.executionNotes || []).map((note) => truncate(note, 200)).filter(Boolean);
    const parts = [
      `Workflow Run: ${normalizeText(input.workflowName || input.workflowKey)} (${normalizeText(input.workflowKey)})`,
      `Provider: ${normalizeText(input.provider)}`,
      `Status: ${normalizeText(input.status)}`,
      `Trigger Source: ${normalizeText(input.triggerSource || '')}`,
      input.resultSummary ? `Result Summary: ${truncate(input.resultSummary, 800)}` : '',
      input.errorSummary ? `Error Summary: ${truncate(input.errorSummary, 800)}` : '',
      notes.length ? `Execution Notes: ${notes.join(' | ')}` : '',
      `Result Data Overview:\n${summarizeResultData(input.resultData || null)}`,
      `Metadata: ${summarizeMetadata(input.metadata || null)}`,
    ].filter(Boolean);

    return truncate(parts.join('\n'), 4_000);
  }

  static async indexWorkflowRun(input: IndexWorkflowRunEmbeddingInput) {
    const content = this.buildWorkflowRunEmbeddingContent(input);
    return this.upsertSourceEmbedding({
      sourceType: 'workflow_run',
      sourceId: input.runId,
      parentId: input.workflowId,
      userId: input.userId ?? null,
      threadId: input.threadId ?? null,
      content,
      metadata: {
        workflowId: input.workflowId,
        workflowKey: input.workflowKey,
        workflowName: input.workflowName,
        provider: input.provider,
        status: input.status,
        triggerSource: input.triggerSource,
      },
      embedOptions: {
        taskType: 'retrieval_document',
        title: input.workflowName || input.workflowKey,
      },
    });
  }

  static async reindexAttachmentChunks(input: {
    attachmentId: string;
    userId?: string | null;
    threadId?: string | null;
    chunks: AttachmentChunkEmbeddingInput[];
  }) {
    await EmbeddingRepo.deleteByParentId('attachment_chunk', input.attachmentId);

    if (!input.chunks.length) {
      return { indexed: 0 };
    }

    let indexed = 0;
    for (const chunk of input.chunks) {
      const content = truncate(normalizeText(chunk.content), 4_000);
      if (!content) continue;

      await this.upsertSourceEmbedding({
        sourceType: 'attachment_chunk',
        sourceId: chunk.id,
        parentId: input.attachmentId,
        userId: input.userId ?? null,
        threadId: input.threadId ?? null,
        content,
        metadata: {
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount ?? null,
          ...(chunk.metadata || {}),
        },
        embedOptions: {
          taskType: 'retrieval_document',
          title: `attachment:${input.attachmentId}:chunk:${chunk.chunkIndex}`,
        },
      });
      indexed += 1;
    }

    logger.info({
      scope: 'embedding-index.service',
      message: 'Attachment chunk embeddings indexed',
      attachmentId: input.attachmentId,
      indexed,
    });

    return { indexed };
  }

  static buildChatSummaryEmbeddingContent(input: IndexChatSummaryEmbeddingInput): string {
    const parts = [
      input.summary ? `Summary: ${truncate(input.summary, 500)}` : '',
      `Content: ${truncate(normalizeText(input.content), 2_000)}`,
      `Metadata: ${summarizeMetadata(input.metadata || null)}`,
    ].filter(Boolean);

    return truncate(parts.join('\n'), 3_000);
  }

  static async indexChatSummary(input: IndexChatSummaryEmbeddingInput) {
    const content = this.buildChatSummaryEmbeddingContent(input);
    return this.upsertSourceEmbedding({
      sourceType: 'chat_summary',
      sourceId: input.contextId,
      userId: input.userId ?? null,
      threadId: input.threadId,
      content,
      metadata: input.metadata ?? null,
      embedOptions: {
        taskType: 'retrieval_document',
        title: input.summary || `thread-summary:${input.contextId}`,
      },
    });
  }
}
