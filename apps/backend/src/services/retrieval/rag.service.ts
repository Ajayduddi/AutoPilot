/**
 * @fileoverview apps/backend/src/services/retrieval/rag.service.ts
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
import { getEmbeddingConfig } from '../../config/embedding.config';
import { ChatRepo } from '../../repositories/chat.repo';
import { logger } from '../../util/logger';
import { SemanticSearchService } from './semantic-search.service';

type AttachmentLike = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  processingStatus: string;
  extractedText?: string | null;
  structuredMetadata?: unknown;
};

type RetrievedChunkRef = {
  attachmentId: string;
  chunkIndex: number;
  content: string;
  similarity?: number;
};

export type RagAttachmentContextResult = {
  promptText: string;
  sourceBlock?: {
    type: 'source';
    origin: string;
    metadata: string[];
  };
  hasEvidence: boolean;
  mode: 'semantic' | 'fallback' | 'none';
  chunks: RetrievedChunkRef[];
};

function truncate(text: string, max: number): string {
  const normalized = String(text || '').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

function attachmentMetaLine(att: AttachmentLike): string {
  const sizeKb = Math.max(1, Math.round((att.sizeBytes || 0) / 1024));
  return `${att.filename} (${att.mimeType}, ${sizeKb} KB, ${att.processingStatus})`;
}

export class RagService {
  static async buildAttachmentContext(input: {
    userId: string;
    threadId: string;
    query: string;
    attachments: AttachmentLike[];
  }): Promise<RagAttachmentContextResult> {
    if (!input.attachments.length) {
      return {
        promptText: '',
        hasEvidence: false,
        mode: 'none',
        chunks: [],
      };
    }

    const config = getEmbeddingConfig();
    const maxChunks = Math.max(1, config.rag.maxChunks);
    const charBudget = Math.max(600, config.rag.chunkTokenBudget * 4);
    const attachmentIds = input.attachments.map((a) => a.id);
    const byAttachment = new Map(input.attachments.map((a) => [a.id, a]));

    try {
      const semantic = await SemanticSearchService.searchDocuments({
        userId: input.userId,
        query: input.query,
        threadId: input.threadId,
        attachmentIds,
        limit: maxChunks,
      });

      if (semantic.results.length > 0) {
        const lines: string[] = [];
        const metadata: string[] = [];
        const chunks: RetrievedChunkRef[] = [];
        let used = 0;

        lines.push('Attached files context (semantic retrieval):');
        for (const row of semantic.results) {
          if (used >= charBudget) break;
          const attachment = byAttachment.get(row.attachmentId);
          if (!attachment) continue;

          const chunkText = truncate(String(row.content || ''), Math.min(1200, charBudget - used));
          if (!chunkText) continue;

          lines.push(`File: ${attachment.filename}`);
          lines.push(`Chunk ${Number(row.chunkIndex) + 1} (score: ${Number(row.similarity || 0).toFixed(3)}): ${chunkText}`);
          lines.push('---');
          used += chunkText.length;

          chunks.push({
            attachmentId: row.attachmentId,
            chunkIndex: Number(row.chunkIndex),
            content: chunkText,
            similarity: Number(row.similarity || 0),
          });

          metadata.push(`${attachment.filename}#${Number(row.chunkIndex) + 1} score=${Number(row.similarity || 0).toFixed(3)}`);
          if (chunks.length >= maxChunks) break;
        }

        if (chunks.length > 0) {
          return {
            promptText: lines.join('\n'),
            sourceBlock: {
              type: 'source',
              origin: 'Processed Files (RAG)',
              metadata: [`retrieval: semantic`, `chunks: ${chunks.length}`, ...metadata.slice(0, 8)],
            },
            hasEvidence: true,
            mode: 'semantic',
            chunks,
          };
        }
      }
    } catch (err) {
      logger.warn({
        scope: 'rag.service',
        message: 'Semantic retrieval for attachment context failed; using fallback extraction context',
        threadId: input.threadId,
        userId: input.userId,
        err,
      });
    }

    const fallbackChunks = await ChatRepo.getAttachmentChunksByAttachmentIds(attachmentIds, {
      limitPerAttachment: Math.max(1, Math.min(6, maxChunks)),
    });

    const lines: string[] = [];
    const metadata: string[] = [];
    const chunks: RetrievedChunkRef[] = [];
    let used = 0;

    lines.push('Attached files context:');

    for (const att of input.attachments) {
      lines.push(`File: ${attachmentMetaLine(att)}`);
      metadata.push(attachmentMetaLine(att));

      const perAttachment = fallbackChunks
        .filter((chunk) => chunk.attachmentId === att.id)
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .slice(0, Math.max(1, Math.ceil(maxChunks / Math.max(1, input.attachments.length))));

      for (const chunk of perAttachment) {
        if (used >= charBudget) break;
        const text = truncate(chunk.content, Math.min(900, charBudget - used));
        if (!text) continue;
        lines.push(`Chunk ${chunk.chunkIndex + 1}: ${text}`);
        used += text.length;
        chunks.push({
          attachmentId: chunk.attachmentId,
          chunkIndex: chunk.chunkIndex,
          content: text,
        });
      }

      if (!perAttachment.length) {
        const extracted = truncate(att.extractedText || '', Math.min(900, Math.max(200, charBudget - used)));
        if (extracted) {
          lines.push(`Extracted text: ${extracted}`);
          used += extracted.length;
          chunks.push({
            attachmentId: att.id,
            chunkIndex: 0,
            content: extracted,
          });
        }
      }

      lines.push('---');
      if (used >= charBudget) break;
    }

    return {
      promptText: lines.join('\n'),
      sourceBlock: {
        type: 'source',
        origin: 'Processed Files',
        metadata: [`retrieval: fallback`, `chunks: ${chunks.length}`, ...metadata.slice(0, 8)],
      },
      hasEvidence: chunks.some((chunk) => String(chunk.content || '').trim().length >= 40),
      mode: 'fallback',
      chunks,
    };
  }
}
