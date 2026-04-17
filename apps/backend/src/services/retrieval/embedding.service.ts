/**
 * @fileoverview apps/backend/src/services/retrieval/embedding.service.ts
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
import { EmbeddingFactory } from '../../providers/embedding/embedding.factory';
import type {
  EmbeddingProvider,
  EmbedTextInput,
  EmbeddingTaskType,
  EmbeddingModelInfo,
  NormalizedEmbeddingError,
} from '../../providers/embedding/provider.interface';
import { getEmbeddingConfig } from '../../config/embedding.config';
import { logger } from '../../util/logger';

export type EmbedTextOptions = {
  provider?: string;
  model?: string;
  taskType?: EmbeddingTaskType;
  title?: string;
};

export type EmbedBatchOptions = {
  provider?: string;
  model?: string;
  taskType?: EmbeddingTaskType;
};

export type EmbeddingResult = {
  vector: number[];
  modelInfo: EmbeddingModelInfo;
};

export type EmbeddingBatchResult = {
  vectors: number[][];
  modelInfo: EmbeddingModelInfo;
};

declare const Bun: {
  sleep(ms: number): Promise<void>;
  CryptoHasher: new (algorithm: 'sha256') => {
    update(data: string): { digest(format: 'hex'): string };
  };
};

export class EmbeddingService {
  static isEnabled(): boolean {
    return getEmbeddingConfig().enabled;
  }

  static hashContent(content: string): string {
    return new Bun.CryptoHasher('sha256').update(String(content || '')).digest('hex');
  }

  static async embedText(text: string, options?: EmbedTextOptions): Promise<EmbeddingResult> {
    const provider = await this.resolveProvider(options?.provider, options?.model);
    const modelInfo = provider.getModelInfo();
    const vectors = await this.embedWithRetry(provider, [{
      text,
      taskType: options?.taskType || 'retrieval_document',
      title: options?.title,
    }]);

    return { vector: vectors[0] || [], modelInfo };
  }

  static async embedBatch(texts: string[], options?: EmbedBatchOptions): Promise<EmbeddingBatchResult> {
    const provider = await this.resolveProvider(options?.provider, options?.model);
    const modelInfo = provider.getModelInfo();
    const safeTexts = texts.map((text) => String(text || '')).filter((text) => text.trim().length > 0);
    if (!safeTexts.length) {
      return { vectors: [], modelInfo };
    }

    const inputs: EmbedTextInput[] = safeTexts.map((text) => ({
      text,
      taskType: options?.taskType || 'retrieval_document',
    }));

    const vectors = await this.embedWithRetry(provider, inputs);
    return { vectors, modelInfo };
  }

  static normalizeError(error: unknown): NormalizedEmbeddingError {
    const message = error instanceof Error ? error.message : String(error || 'Unknown embeddings error');
    return {
      provider: 'unknown',
      code: 'EMBEDDING_SERVICE_ERROR',
      message,
      retryable: false,
      cause: error,
    };
  }

  private static async resolveProvider(provider?: string, model?: string): Promise<EmbeddingProvider> {
    if (!getEmbeddingConfig().enabled) {
      throw new Error('Embeddings are disabled by configuration.');
    }

    return EmbeddingFactory.getProvider({ provider, model });
  }

  private static async embedWithRetry(provider: EmbeddingProvider, inputs: EmbedTextInput[]): Promise<number[][]> {
    const modelInfo = provider.getModelInfo();
    const chunks = this.chunkInputs(inputs, modelInfo.maxBatchSize);
    const vectors: number[][] = [];

    for (const chunk of chunks) {
      const chunkVectors = await this.runWithRetry(async () => provider.embedBatch(chunk), provider);
      vectors.push(...chunkVectors);
    }

    return vectors;
  }

  private static chunkInputs(inputs: EmbedTextInput[], size: number): EmbedTextInput[][] {
    const chunkSize = Math.max(1, size);
    const chunks: EmbedTextInput[][] = [];
    for (let i = 0; i < inputs.length; i += chunkSize) {
      chunks.push(inputs.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private static async runWithRetry<T>(operation: () => Promise<T>, provider: EmbeddingProvider): Promise<T> {
    const config = getEmbeddingConfig();
    const attempts = Math.max(1, config.retry.maxAttempts);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const normalized = provider.normalizeError(error);
        lastError = normalized;

        const shouldRetry = normalized.retryable && attempt < attempts;
        logger.warn({
          scope: 'embedding.service',
          message: 'Embedding generation attempt failed',
          provider: normalized.provider,
          code: normalized.code,
          retryable: normalized.retryable,
          attempt,
          attempts,
        });

        if (!shouldRetry) break;

        const jitter = Math.floor(Math.random() * 50);
        const delayMs = config.retry.baseDelayMs * attempt + jitter;
        await Bun.sleep(delayMs);
      }
    }

    throw this.toError(lastError);
  }

  private static toError(error: unknown): Error {
    if (error instanceof Error) return error;
    if (error && typeof error === 'object') {
      const normalized = error as NormalizedEmbeddingError;
      if (normalized.message) {
        return new Error(`[${normalized.code}] ${normalized.message}`);
      }
    }
    return new Error(String(error || 'Unknown embeddings error'));
  }
}
