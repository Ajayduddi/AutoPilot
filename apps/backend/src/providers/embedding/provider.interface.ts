/**
 * @fileoverview apps/backend/src/providers/embedding/provider.interface.ts
 *
 * High-level purpose:
 * Provider integration module that adapts external AI/workflow capabilities to backend contracts.
 *
 * Key Features (and trade-offs):
 * - Normalizes external provider behavior into typed platform interfaces.
 * - Supports provider selection and runtime interoperability.
 * - Keeps vendor-specific details isolated from orchestration logic.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Implement provider contracts with deterministic request/response mapping.
 * 3. Use factories to select providers at runtime.
 * 4. Validate adapters with integration and fallback tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
export type EmbeddingTaskType = 'retrieval_document' | 'retrieval_query' | 'classification' | 'semantic_similarity';

export type EmbedTextInput = {
  text: string;
  taskType?: EmbeddingTaskType;
  title?: string;
};

export type EmbeddingModelInfo = {
  provider: string;
  model: string;
  dimensions: number;
  maxBatchSize: number;
};

export type NormalizedEmbeddingError = {
  provider: string;
  code: string;
  message: string;
  retryable: boolean;
  cause?: unknown;
};

export interface EmbeddingProvider {
  name: string;
  embedText(input: EmbedTextInput): Promise<number[]>;
  embedBatch(inputs: EmbedTextInput[]): Promise<number[][]>;
  getModelInfo(): EmbeddingModelInfo;
  normalizeError(error: unknown): NormalizedEmbeddingError;
}
