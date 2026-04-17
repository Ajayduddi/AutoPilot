/**
 * @fileoverview apps/backend/src/providers/embedding/gemini-embedding.provider.ts
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
import type {
  EmbedTextInput,
  EmbeddingProvider,
  EmbeddingModelInfo,
  NormalizedEmbeddingError,
} from './provider.interface';

type GeminiBatchEmbeddingResponse = {
  embeddings?: Array<{
    values?: number[];
  }>;
};

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  name = 'gemini';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number,
    private readonly maxBatchSize: number,
  ) {}

  getModelInfo(): EmbeddingModelInfo {
    return {
      provider: this.name,
      model: this.model,
      dimensions: this.dimensions,
      maxBatchSize: this.maxBatchSize,
    };
  }

  async embedText(input: EmbedTextInput): Promise<number[]> {
    const [vector] = await this.embedBatch([input]);
    if (!vector) {
      throw new Error('Gemini embeddings returned an empty vector.');
    }
    return vector;
  }

  async embedBatch(inputs: EmbedTextInput[]): Promise<number[][]> {
    if (!inputs.length) return [];
    this.assertReady();

    const url = this.getBatchEndpoint();
    const body = {
      requests: inputs.map((input) => ({
        model: this.getModelPath(),
        content: {
          parts: [{ text: input.text }],
        },
        taskType: this.mapTaskType(input.taskType),
        title: input.title,
        outputDimensionality: this.dimensions,
      })),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Gemini embeddings API error (${response.status}): ${detail || response.statusText}`);
    }

    const data = (await response.json()) as GeminiBatchEmbeddingResponse;
    const vectors = (data.embeddings || []).map((item) => item.values || []);

    if (vectors.length !== inputs.length) {
      throw new Error(`Gemini embeddings response count mismatch: expected ${inputs.length}, got ${vectors.length}.`);
    }

    for (const vector of vectors) {
      if (!Array.isArray(vector) || vector.length !== this.dimensions) {
        throw new Error(`Gemini embedding dimensions mismatch: expected ${this.dimensions}, got ${vector?.length || 0}.`);
      }
    }

    return vectors;
  }

  normalizeError(error: unknown): NormalizedEmbeddingError {
    const message = error instanceof Error ? error.message : String(error || 'Unknown embeddings error');
    const lower = message.toLowerCase();

    const retryable =
      lower.includes('timeout') ||
      lower.includes('429') ||
      lower.includes('rate') ||
      lower.includes('tempor') ||
      lower.includes('network') ||
      lower.includes('econnreset');

    let code = 'EMBEDDING_PROVIDER_ERROR';
    if (lower.includes('unauthorized') || lower.includes('403') || lower.includes('401') || lower.includes('api key')) {
      code = 'EMBEDDING_PROVIDER_AUTH';
    } else if (lower.includes('rate') || lower.includes('429')) {
      code = 'EMBEDDING_PROVIDER_RATE_LIMIT';
    } else if (lower.includes('dimension')) {
      code = 'EMBEDDING_DIMENSION_MISMATCH';
    }

    return {
      provider: this.name,
      code,
      message,
      retryable,
      cause: error,
    };
  }

  private assertReady(): void {
    if (!this.apiKey) {
      throw new Error('Gemini embedding API key is missing.');
    }
  }

  private getModelPath(): string {
    return this.model.startsWith('models/') ? this.model : `models/${this.model}`;
  }

  private getBatchEndpoint(): string {
    return `https://generativelanguage.googleapis.com/v1beta/${this.getModelPath()}:batchEmbedContents`;
  }

  private mapTaskType(taskType?: string): string {
    switch (taskType) {
      case 'retrieval_query':
        return 'RETRIEVAL_QUERY';
      case 'classification':
        return 'CLASSIFICATION';
      case 'semantic_similarity':
        return 'SEMANTIC_SIMILARITY';
      case 'retrieval_document':
      default:
        return 'RETRIEVAL_DOCUMENT';
    }
  }
}
