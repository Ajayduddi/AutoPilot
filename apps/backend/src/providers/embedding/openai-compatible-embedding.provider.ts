/**
 * @fileoverview apps/backend/src/providers/embedding/openai-compatible-embedding.provider.ts
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

type OpenAICompatibleEmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
};

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(
    public readonly name: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
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
      throw new Error(`${this.name} embeddings returned an empty vector.`);
    }
    return vector;
  }

  async embedBatch(inputs: EmbedTextInput[]): Promise<number[][]> {
    if (!inputs.length) return [];
    this.assertReady();

    const response = await fetch(this.getEmbeddingsEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: inputs.map((input) => input.text),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${this.name} embeddings API error (${response.status}): ${detail || response.statusText}`);
    }

    const data = (await response.json()) as OpenAICompatibleEmbeddingResponse;
    const vectors = (data.data || []).map((item) => item.embedding || []);

    if (vectors.length !== inputs.length) {
      throw new Error(`${this.name} embeddings response count mismatch: expected ${inputs.length}, got ${vectors.length}.`);
    }

    for (const vector of vectors) {
      if (!Array.isArray(vector) || !vector.length) {
        throw new Error(`${this.name} embeddings returned an invalid vector payload.`);
      }
      if (this.dimensions > 0 && vector.length !== this.dimensions) {
        throw new Error(`${this.name} embedding dimensions mismatch: expected ${this.dimensions}, got ${vector.length}.`);
      }
    }

    return vectors;
  }

  normalizeError(error: unknown): NormalizedEmbeddingError {
    const message = error instanceof Error ? error.message : String(error || 'Unknown embeddings error');
    const lower = message.toLowerCase();
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
      retryable: lower.includes('timeout') || lower.includes('429') || lower.includes('rate') || lower.includes('network'),
      cause: error,
    };
  }

  private assertReady(): void {
    if (!this.apiKey) {
      throw new Error(`${this.name} embedding API key is missing.`);
    }
    if (!this.baseUrl) {
      throw new Error(`${this.name} embedding base URL is missing.`);
    }
  }

  private getEmbeddingsEndpoint(): string {
    return `${this.baseUrl.replace(/\/$/, '')}/embeddings`;
  }
}
