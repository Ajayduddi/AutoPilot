/**
 * @fileoverview apps/backend/src/providers/embedding/embedding.factory.ts
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
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { providerConfigs } from '../../db/schema';
import { getEmbeddingConfig } from '../../config/embedding.config';
import { LLMFactory } from '../llm/llm.factory';
import type { EmbeddingProvider } from './provider.interface';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider';
import { BgeLocalEmbeddingProvider } from './bge-local-embedding.provider';
import { OpenAICompatibleEmbeddingProvider } from './openai-compatible-embedding.provider';
import { ProviderConfigRepo } from '../../repositories/provider-config.repo';

type EmbeddingProviderRequest = {
  provider?: string;
  apiProvider?: string;
  apiProviderId?: string;
  model?: string;
};

export class EmbeddingFactory {
  static async getProvider(input?: EmbeddingProviderRequest): Promise<EmbeddingProvider> {
    const config = getEmbeddingConfig();
    const providerName = this.normalizeProviderName(String(input?.provider || config.provider || 'api'));
    const apiProvider = String(input?.apiProvider || config.apiProvider || '').trim().toLowerCase();
    const apiProviderId = String(input?.apiProviderId || config.apiProviderId || '').trim();

    if (providerName === 'gemini') {
      if (apiProvider !== 'gemini') {
        const apiProviderConfig = await this.resolveApiProviderConfig(apiProvider, apiProviderId);
        if (!apiProviderConfig?.apiKey) {
          throw new Error(`Embedding API key is missing for provider: ${apiProvider}`);
        }
        const model = String(input?.model || config.gemini.model || '').trim();
        if (!model) {
          throw new Error(`Embedding model is missing for provider: ${apiProvider}`);
        }

        return new OpenAICompatibleEmbeddingProvider(
          apiProvider,
          apiProviderConfig.apiKey,
          model,
          apiProviderConfig.baseUrl,
          config.gemini.dimensions,
          config.gemini.maxBatchSize,
        );
      }

      const geminiSettings = await this.resolveGeminiSettingsFromProviderConfig(apiProviderId);
      const apiKey = geminiSettings.apiKey || config.gemini.apiKey || '';
      const model = String(input?.model || geminiSettings.model || config.gemini.model || 'text-embedding-004');

      return new GeminiEmbeddingProvider(
        apiKey,
        model,
        config.gemini.dimensions,
        config.gemini.maxBatchSize,
      );
    }

    if (providerName === 'bge_local') {
      return new BgeLocalEmbeddingProvider({
        providerName: 'bge_local',
        model: String(input?.model || config.bgeLocal.model || 'Xenova/bge-small-en-v1.5'),
        dimensions: config.bgeLocal.dimensions,
        maxBatchSize: config.bgeLocal.maxBatchSize,
        cacheDir: config.bgeLocal.cacheDir,
        allowRemoteModels: config.bgeLocal.allowRemoteModels,
        quantized: config.bgeLocal.quantized,
      });
    }

    if (providerName === 'minilm_local') {
      return new BgeLocalEmbeddingProvider({
        providerName: 'minilm_local',
        model: String(input?.model || config.minilmLocal.model || 'Xenova/all-MiniLM-L6-v2'),
        dimensions: config.minilmLocal.dimensions,
        maxBatchSize: config.minilmLocal.maxBatchSize,
        cacheDir: config.minilmLocal.cacheDir,
        allowRemoteModels: config.minilmLocal.allowRemoteModels,
        quantized: config.minilmLocal.quantized,
      });
    }

    throw new Error(`Unsupported embedding provider: ${providerName}`);
  }

  private static normalizeProviderName(input: string): 'gemini' | 'bge_local' | 'minilm_local' {
    const normalized = String(input || '').trim().toLowerCase();
    if (normalized === 'bge_local' || normalized === 'bge-small-local' || normalized === 'local_bge') {
      return 'bge_local';
    }
    if (normalized === 'minilm_local' || normalized === 'all-minilm-l6-v2' || normalized === 'local_minilm') {
      return 'minilm_local';
    }
    // 'api' (new discriminator) and 'gemini' (legacy) both route to API-based embedding providers
    return 'gemini';
  }

  private static async resolveGeminiSettingsFromProviderConfig(providerId?: string): Promise<{ apiKey: string | null; model: string | null }> {
    const byId = providerId ? await ProviderConfigRepo.findById(providerId) : null;
    if (byId) {
      return {
        apiKey: await ProviderConfigRepo.decryptApiKey(byId),
        model: byId.model || null,
      };
    }

    const defaultGemini = await ProviderConfigRepo.findDefaultForProvider('gemini');
    if (defaultGemini) {
      return {
        apiKey: await ProviderConfigRepo.decryptApiKey(defaultGemini),
        model: defaultGemini.model || null,
      };
    }

    const anyGemini = await ProviderConfigRepo.findFirstForProvider('gemini');
    if (anyGemini) {
      return {
        apiKey: await ProviderConfigRepo.decryptApiKey(anyGemini),
        model: anyGemini.model || null,
      };
    }

    return { apiKey: null, model: null };
  }

  private static async resolveApiProviderConfig(provider: string, providerId?: string): Promise<{ apiKey: string | null; baseUrl: string }> {
    const normalized = String(provider || '').trim().toLowerCase();
    const byId = providerId ? await ProviderConfigRepo.findById(providerId) : null;
    const defaultRow = !byId ? await ProviderConfigRepo.findDefaultForProvider(normalized) : null;
    const row = byId || defaultRow || await ProviderConfigRepo.findFirstForProvider(normalized);

    const apiKey = await ProviderConfigRepo.decryptApiKey(row);
    const baseUrl = String(row?.baseUrl || this.defaultBaseUrlForProvider(normalized)).trim();
    return { apiKey, baseUrl };
  }

  private static defaultBaseUrlForProvider(provider: string): string {
    if (provider === 'mistral') return 'https://api.mistral.ai/v1';
    if (provider === 'groq') return 'https://api.groq.com/openai/v1';
    return 'https://api.openai.com/v1';
  }
}
