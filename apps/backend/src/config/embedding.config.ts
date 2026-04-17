/**
 * @fileoverview apps/backend/src/config/embedding.config.ts
 *
 * High-level purpose:
 * Runtime configuration contracts, loading, and normalization for backend execution.
 *
 * Key Features (and trade-offs):
 * - Validates and shapes environment/runtime config values.
 * - Provides typed accessors for production-safe settings.
 * - Supports deterministic configuration behavior across environments.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Add new settings in centralized config contracts.
 * 3. Avoid scattering env access outside config modules.
 * 4. Typecheck and config tests should validate changes.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { z } from 'zod';
import { getRuntimeConfig } from './runtime.config';

export type EmbeddingProviderName = 'api' | 'bge_local' | 'minilm_local';

export type EmbeddingConfig = {
  enabled: boolean;
  provider: EmbeddingProviderName;
  apiProvider: string;
  apiProviderId: string;
  debug: boolean;
  indexing: {
    batchSize: number;
  };
  retrieval: {
    topK: number;
    similarityThreshold: number;
  };
  rag: {
    maxChunks: number;
    chunkTokenBudget: number;
  };
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
  };
  gemini: {
    apiKey: string;
    model: string;
    dimensions: number;
    maxBatchSize: number;
  };
  bgeLocal: {
    model: string;
    dimensions: number;
    maxBatchSize: number;
    cacheDir: string;
    allowRemoteModels: boolean;
    quantized: boolean;
  };
  minilmLocal: {
    model: string;
    dimensions: number;
    maxBatchSize: number;
    cacheDir: string;
    allowRemoteModels: boolean;
    quantized: boolean;
  };
};

const configSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['api', 'bge_local', 'minilm_local']),
  apiProvider: z.string(),
  apiProviderId: z.string(),
  debug: z.boolean(),
  indexing: z.object({
    batchSize: z.number().int().positive(),
  }),
  retrieval: z.object({
    topK: z.number().int().positive(),
    similarityThreshold: z.number().min(0).max(1),
  }),
  rag: z.object({
    maxChunks: z.number().int().positive(),
    chunkTokenBudget: z.number().int().positive(),
  }),
  retry: z.object({
    maxAttempts: z.number().int().positive(),
    baseDelayMs: z.number().int().positive(),
  }),
  gemini: z.object({
    apiKey: z.string(),
    model: z.string().min(1),
    dimensions: z.number().int().positive(),
    maxBatchSize: z.number().int().positive(),
  }),
  bgeLocal: z.object({
    model: z.string().min(1),
    dimensions: z.number().int().positive(),
    maxBatchSize: z.number().int().positive(),
    cacheDir: z.string(),
    allowRemoteModels: z.boolean(),
    quantized: z.boolean(),
  }),
  minilmLocal: z.object({
    model: z.string().min(1),
    dimensions: z.number().int().positive(),
    maxBatchSize: z.number().int().positive(),
    cacheDir: z.string(),
    allowRemoteModels: z.boolean(),
    quantized: z.boolean(),
  }),
});

let cached: EmbeddingConfig | null = null;

function parseBoolean(input: unknown, fallback: boolean): boolean {
  if (typeof input === 'boolean') return input;
  if (typeof input !== 'string') return fallback;
  const normalized = input.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

function parseNumber(input: unknown, fallback: number): number {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string' && input.trim()) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function getEmbeddingConfig(): EmbeddingConfig {
  if (cached) return cached;

  const runtime = getRuntimeConfig();
  const runtimeRetrieval = runtime.retrievalEmbedding;
  const providerRuntimeRaw = String(runtimeRetrieval.embeddingProvider || 'api').trim().toLowerCase();
  const provider: EmbeddingProviderName =
    providerRuntimeRaw === 'bge_local'
      ? 'bge_local'
      : providerRuntimeRaw === 'minilm_local'
        ? 'minilm_local'
        : 'api';
  const apiProvider = String(
    runtimeRetrieval.embeddingApiProvider || '',
  ).trim().toLowerCase();
  const apiProviderId = String(
    runtimeRetrieval.embeddingApiProviderId || '',
  ).trim();
  const geminiDefaultDimensions = 768;
  const bgeDefaultDimensions = 768;
  const localModelUnified = String(process.env.LOCAL_EMBEDDING_MODEL || '').trim();
  const localDimensionsUnified = process.env.LOCAL_EMBEDDING_DIMENSIONS;
  const localBatchUnified = process.env.LOCAL_EMBEDDING_MAX_BATCH_SIZE;
  const localCacheUnified = String(process.env.LOCAL_EMBEDDING_CACHE_DIR || '').trim();
  const localAllowRemoteUnified = process.env.LOCAL_EMBEDDING_ALLOW_REMOTE_MODELS;
  const localQuantizedUnified = process.env.LOCAL_EMBEDDING_QUANTIZED;
  const modelUnified = String(process.env.EMBEDDING_MODEL || '').trim();
  const batchUnified = process.env.EMBEDDING_MAX_BATCH_SIZE;
  const cacheUnified = String(process.env.EMBEDDING_CACHE_DIR || '').trim();
  const allowRemoteUnified = process.env.EMBEDDING_ALLOW_REMOTE_MODELS;
  const quantizedUnified = process.env.EMBEDDING_QUANTIZED;
  const apiKeyUnified = String(runtimeRetrieval.embeddingApiKey || '').trim();

  const raw = {
    enabled: true,
    provider,
    apiProvider,
    apiProviderId,
    debug: runtimeRetrieval.embeddingsDebug,
    indexing: {
      batchSize: runtimeRetrieval.embeddingsIndexBatchSize,
    },
    retrieval: {
      topK: runtimeRetrieval.semanticSearchTopKDefault,
      similarityThreshold: runtimeRetrieval.semanticSearchMinScore,
    },
    rag: {
      maxChunks: runtimeRetrieval.ragMaxChunks,
      chunkTokenBudget: runtimeRetrieval.ragChunkTokenBudget,
    },
    retry: {
      maxAttempts: runtimeRetrieval.embeddingsRetryMaxAttempts,
      baseDelayMs: runtimeRetrieval.embeddingsRetryBaseDelayMs,
    },
    gemini: {
      apiKey: String(apiKeyUnified || process.env.GEMINI_API_KEY || process.env.GEMINI_EMBEDDING_API_KEY || ''),
      model: String(runtimeRetrieval.embeddingModel || process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004'),
      dimensions: parseNumber(process.env.GEMINI_EMBEDDING_DIMENSIONS || runtimeRetrieval.embeddingVectorDimensions || process.env.EMBEDDING_VECTOR_DIMENSIONS, geminiDefaultDimensions),
      maxBatchSize: parseNumber(runtimeRetrieval.embeddingMaxBatchSize || process.env.GEMINI_EMBEDDING_MAX_BATCH_SIZE, 32),
    },
    bgeLocal: {
      model: String(runtimeRetrieval.embeddingModel || localModelUnified || process.env.BGE_LOCAL_MODEL || 'Xenova/bge-small-en-v1.5'),
      dimensions: parseNumber(localDimensionsUnified || runtimeRetrieval.embeddingVectorDimensions || process.env.BGE_LOCAL_DIMENSIONS || process.env.EMBEDDING_VECTOR_DIMENSIONS, bgeDefaultDimensions),
      maxBatchSize: parseNumber(runtimeRetrieval.embeddingMaxBatchSize || localBatchUnified || process.env.BGE_LOCAL_MAX_BATCH_SIZE, 8),
      cacheDir: String(runtimeRetrieval.embeddingCacheDir || localCacheUnified || process.env.BGE_LOCAL_CACHE_DIR || ''),
      allowRemoteModels: parseBoolean(allowRemoteUnified ?? localAllowRemoteUnified ?? runtimeRetrieval.embeddingAllowRemoteModels ?? process.env.BGE_LOCAL_ALLOW_REMOTE_MODELS, true),
      quantized: parseBoolean(quantizedUnified ?? localQuantizedUnified ?? runtimeRetrieval.embeddingQuantized ?? process.env.BGE_LOCAL_QUANTIZED, true),
    },
    minilmLocal: {
      model: String(runtimeRetrieval.embeddingModel || localModelUnified || process.env.MINILM_LOCAL_MODEL || 'Xenova/all-MiniLM-L6-v2'),
      dimensions: parseNumber(localDimensionsUnified || runtimeRetrieval.embeddingVectorDimensions || process.env.MINILM_LOCAL_DIMENSIONS || process.env.EMBEDDING_VECTOR_DIMENSIONS, bgeDefaultDimensions),
      maxBatchSize: parseNumber(runtimeRetrieval.embeddingMaxBatchSize || localBatchUnified || process.env.MINILM_LOCAL_MAX_BATCH_SIZE, 16),
      cacheDir: String(runtimeRetrieval.embeddingCacheDir || localCacheUnified || process.env.MINILM_LOCAL_CACHE_DIR || process.env.BGE_LOCAL_CACHE_DIR || ''),
      allowRemoteModels: parseBoolean(allowRemoteUnified ?? localAllowRemoteUnified ?? runtimeRetrieval.embeddingAllowRemoteModels ?? process.env.MINILM_LOCAL_ALLOW_REMOTE_MODELS, true),
      quantized: parseBoolean(quantizedUnified ?? localQuantizedUnified ?? runtimeRetrieval.embeddingQuantized ?? process.env.MINILM_LOCAL_QUANTIZED, true),
    },
  };

  cached = configSchema.parse(raw);
  return cached;
}

export function resetEmbeddingConfigCache(): void {
  cached = null;
}
