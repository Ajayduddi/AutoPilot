/**
 * @fileoverview apps/backend/src/services/retrieval/recommendation.service.ts
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
import { RecommendationRepo } from '../../repositories/recommendation.repo';
import { getEmbeddingConfig } from '../../config/embedding.config';
import { logger } from '../../util/logger';

function clip(text: string | null | undefined, max = 320): string | null {
  if (!text) return null;
  const normalized = String(text).trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

export class RecommendationService {
  static async recommendSimilarWorkflows(input: {
    workflowId: string;
    userId: string;
    limit?: number;
    minScore?: number;
  }) {
    const cfg = getEmbeddingConfig();
    const limit = Math.max(1, Math.min(30, input.limit || cfg.retrieval.topK));
    const minScore = Math.max(0, Math.min(1, input.minScore ?? cfg.retrieval.similarityThreshold));

    try {
      const rows = await RecommendationRepo.recommendWorkflows({
        workflowId: input.workflowId,
        userId: input.userId,
        limit,
        minScore,
      });

      return {
        mode: 'semantic' as const,
        results: rows.map((row) => ({
          ...row,
          description: clip(row.description),
          similarity: Number(row.similarity || 0),
        })),
      };
    } catch (err) {
      logger.warn({
        scope: 'recommendation.service',
        message: 'Workflow recommendations unavailable',
        workflowId: input.workflowId,
        userId: input.userId,
        err,
      });
      return { mode: 'unavailable' as const, results: [] };
    }
  }

  static async recommendRelatedRuns(input: {
    runId: string;
    userId: string;
    limit?: number;
    minScore?: number;
    onlyFailures?: boolean;
  }) {
    const cfg = getEmbeddingConfig();
    const limit = Math.max(1, Math.min(30, input.limit || cfg.retrieval.topK));
    const minScore = Math.max(0, Math.min(1, input.minScore ?? cfg.retrieval.similarityThreshold));

    try {
      const rows = await RecommendationRepo.recommendRuns({
        runId: input.runId,
        userId: input.userId,
        limit,
        minScore,
        onlyFailures: input.onlyFailures,
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
        scope: 'recommendation.service',
        message: 'Run recommendations unavailable',
        runId: input.runId,
        userId: input.userId,
        err,
      });
      return { mode: 'unavailable' as const, results: [] };
    }
  }

  static async recommendRelatedDocumentChunks(input: {
    attachmentId: string;
    userId: string;
    limit?: number;
    minScore?: number;
  }) {
    const cfg = getEmbeddingConfig();
    const limit = Math.max(1, Math.min(30, input.limit || cfg.retrieval.topK));
    const minScore = Math.max(0, Math.min(1, input.minScore ?? cfg.retrieval.similarityThreshold));

    try {
      const rows = await RecommendationRepo.recommendDocumentChunks({
        attachmentId: input.attachmentId,
        userId: input.userId,
        limit,
        minScore,
      });

      return {
        mode: 'semantic' as const,
        results: rows.map((row) => ({
          ...row,
          content: clip(row.content, 360) || '',
          similarity: Number(row.similarity || 0),
        })),
      };
    } catch (err) {
      logger.warn({
        scope: 'recommendation.service',
        message: 'Document recommendations unavailable',
        attachmentId: input.attachmentId,
        userId: input.userId,
        err,
      });
      return { mode: 'unavailable' as const, results: [] };
    }
  }
}
