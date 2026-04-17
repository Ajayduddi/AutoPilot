/**
 * @fileoverview apps/backend/src/providers/embedding/bge-local-embedding.provider.ts
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

type BgeLocalProviderInput = {
  providerName?: string;
  model: string;
  dimensions: number;
  maxBatchSize: number;
  cacheDir?: string;
  allowRemoteModels?: boolean;
  quantized?: boolean;
};

type TransformersEnv = {
  allowRemoteModels?: boolean;
  cacheDir?: string;
};

type EmbeddingTensor = {
  data: Float32Array | number[];
  dims?: number[];
};

type FeatureExtractor = (input: string, options?: Record<string, unknown>) => Promise<EmbeddingTensor>;

type TransformersModule = {
  env: TransformersEnv;
  pipeline: (task: 'feature-extraction', model: string, options?: Record<string, unknown>) => Promise<FeatureExtractor>;
};

export class BgeLocalEmbeddingProvider implements EmbeddingProvider {
  name: string;
  private extractorPromise: Promise<FeatureExtractor> | null = null;

  constructor(private readonly options: BgeLocalProviderInput) {
    this.name = options.providerName || 'bge_local';
  }

  getModelInfo(): EmbeddingModelInfo {
    return {
      provider: this.name,
      model: this.options.model,
      dimensions: this.options.dimensions,
      maxBatchSize: this.options.maxBatchSize,
    };
  }

  async embedText(input: EmbedTextInput): Promise<number[]> {
    const [vector] = await this.embedBatch([input]);
    if (!vector) {
      throw new Error('BGE local embeddings returned an empty vector.');
    }
    return vector;
  }

  async embedBatch(inputs: EmbedTextInput[]): Promise<number[][]> {
    if (!inputs.length) return [];
    const extractor = await this.getExtractor();
    const vectors: number[][] = [];

    for (const input of inputs) {
      const text = String(input.text || '').trim();
      if (!text) {
        vectors.push(this.zeroVector(this.options.dimensions));
        continue;
      }

      const out = await extractor(text, {
        pooling: 'mean',
        normalize: true,
      });

      const raw = Array.from(out.data || []);
      vectors.push(this.fitDimensions(raw));
    }

    return vectors;
  }

  normalizeError(error: unknown): NormalizedEmbeddingError {
    const message = error instanceof Error ? error.message : String(error || 'Unknown local embedding error');
    const lower = message.toLowerCase();
    const retryable =
      lower.includes('timeout') ||
      lower.includes('tempor') ||
      lower.includes('network') ||
      lower.includes('econnreset');

    let code = 'EMBEDDING_PROVIDER_ERROR';
    if (lower.includes('model') && lower.includes('not found')) {
      code = 'EMBEDDING_MODEL_NOT_FOUND';
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

  private async getExtractor(): Promise<FeatureExtractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = this.loadExtractor();
    }
    return this.extractorPromise;
  }

  private async loadExtractor(): Promise<FeatureExtractor> {
    const mod = (await import('@xenova/transformers')) as unknown as TransformersModule;

    if (typeof this.options.allowRemoteModels === 'boolean') {
      mod.env.allowRemoteModels = this.options.allowRemoteModels;
    }
    if (this.options.cacheDir) {
      mod.env.cacheDir = this.options.cacheDir;
    }

    return mod.pipeline('feature-extraction', this.options.model, {
      quantized: this.options.quantized ?? true,
    });
  }

  private fitDimensions(raw: number[]): number[] {
    const target = Math.max(1, this.options.dimensions);
    if (raw.length === target) return raw;
    if (raw.length > target) return raw.slice(0, target);

    const padded = raw.slice();
    padded.push(...new Array(target - raw.length).fill(0));
    return padded;
  }

  private zeroVector(dimensions: number): number[] {
    return new Array(Math.max(1, dimensions)).fill(0);
  }
}
