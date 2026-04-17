/**
 * @fileoverview providers/llm/llm.factory.
 *
 * High-level purpose:
 * Centralized provider resolver that maps persisted provider configuration to
 * concrete LLM adapter instances at runtime.
 * Business value: gives operations teams model/provider agility (OpenAI,
 * Gemini, Ollama, Groq, Mistral) through settings instead of code changes.
 * System impact: acts as the single composition point for all backend LLM
 * calls and fallback behavior when provider config is missing.
 *
 * Key Features (and trade-offs):
 * - Default-provider discovery and per-request provider override support.
 * - Model/base-url normalization across heterogeneous provider conventions.
 * - Encrypted API key decryption via provider-key crypto utilities.
 * - Safe fallback to Ollama when no provider is configured.
 * - Trade-off: centralized branching increases factory complexity as provider
 *   matrix grows.
 *
 * Usage Guide:
 * 1. Persist provider config (id/provider/model/baseUrl/apiKey) in settings.
 * 2. Call `LLMFactory.getProvider(providerId, overriddenModel?)`.
 * 3. Pass returned adapter into higher-level services (`LLMService`).
 * 4. For new providers, add adapter class and extend switch in
 *    `createProviderFromConfig`.
 * 5. Validate with provider-fallback and route integration tests.
 */
import { db } from '../../db';
import { providerConfigs } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { ILLMProvider } from './provider.interface';
import { OllamaProvider } from './ollama.provider';
import { GeminiProvider } from './gemini.provider';
import { OpenAIProvider } from './openai.provider';
import { getRuntimeConfig } from '../../config/runtime.config';
import { logger } from '../../util/logger';
import { decryptProviderApiKey } from '../../util/provider-key-crypto';
import { ProviderConfigRepo } from '../../repositories/provider-config.repo';

/**
 * LLMFactory class.
 *
 * Encapsulates llmfactory behavior for provider integration logic.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class LLMFactory {
  static decryptProviderApiKey = decryptProviderApiKey;

    static isAutoSelection(providerId?: string, model?: string): boolean {
        const normalizedProvider = String(providerId || '').trim().toLowerCase();
        const normalizedModel = String(model || '').trim().toLowerCase();
    return normalizedProvider === 'auto' || normalizedModel === 'auto';
  }

    static normalizeProviderPrefix(provider: string): string {
        const normalized = String(provider || '').trim().toLowerCase();
    if (normalized === 'ollama_cloud') return 'ollama';
    return normalized;
  }

    static resolveMastraModel(provider: string, model: string): string {
        const trimmedModel = String(model || '').trim();
    if (trimmedModel.includes('/')) return trimmedModel;
    return `${this.normalizeProviderPrefix(provider)}/${trimmedModel}`;
  }

    private static normalizeProviderBaseUrl(provider: string, baseUrl?: string | null): string {
        const fallback = this.defaultBaseUrlForProvider(provider);
        const base = (baseUrl || fallback || '').trim().replace(/\/$/, '');
    if (provider !== 'ollama_cloud' && provider !== 'ollama') return base;

    try {
            const url = new URL(base);
            const path = url.pathname.replace(/\/+$/, '');
      if (path.endsWith('/api/openai/v1') || path.endsWith('/v1')) {
        url.pathname = '';
        return url.toString().replace(/\/$/, '');
      }
    } catch {
      // Best-effort fallback below
    }

    if (/\/api\/openai\/v1$/i.test(base) || /\/v1$/i.test(base)) {
      return base.replace(/\/api\/openai\/v1$/i, '').replace(/\/v1$/i, '');
    }
    return base;
  }

    private static defaultModelForProvider(provider: string): string {
    switch (provider) {
      case 'ollama':
        return 'llama3';
      case 'gemini':
        return 'gemini-2.5-flash';
      case 'groq':
        return 'llama-3.1-8b-instant';
      case 'mistral':
        return 'mistral-small-latest';
      case 'ollama_cloud':
        return 'llama3.1:8b';
      case 'openai':
      default:
        return 'gpt-4o-mini';
    }
  }

    private static resolveModel(provider: string, configuredModel?: string | null, overriddenModel?: string): string {
        const m = (overriddenModel || configuredModel || '').trim();
    if (!m || m === 'dynamic' || m === 'auto') {
      return this.defaultModelForProvider(provider);
    }
    return m;
  }

    private static defaultBaseUrlForProvider(provider: string): string {
    switch (provider) {
      case 'ollama':
        return 'http://localhost:11434';
      case 'groq':
        return 'https://api.groq.com/openai/v1';
      case 'mistral':
        return 'https://api.mistral.ai/v1';
      case 'ollama_cloud':
        return 'https://ollama.com';
      case 'openai':
      default:
        return 'https://api.openai.com/v1';
    }
  }

    static async getProviderConfig(providerId?: string): Promise<typeof providerConfigs.$inferSelect | null> {
    if (providerId && providerId.trim() && providerId.trim().toLowerCase() !== 'auto') {
      const byId = await ProviderConfigRepo.findById(providerId.trim());
      if (byId) return byId;
    }

    const byDefault = await ProviderConfigRepo.findDefault();
    if (byDefault) return byDefault;

    const first = await ProviderConfigRepo.findFirst();
    return first || null;
  }

  static async createProviderFromConfig(
    config: typeof providerConfigs.$inferSelect,
    overriddenModel?: string,
  ): Promise<ILLMProvider> {
    const normalizedConfig = await ProviderConfigRepo.maybeMigratePlaintextApiKey(config);
    const m = this.resolveModel(normalizedConfig?.provider || config.provider, normalizedConfig?.model || config.model, overriddenModel);
    const apiKey = await this.decryptProviderApiKey(normalizedConfig?.apiKey);

    switch (normalizedConfig?.provider || config.provider) {
      case 'ollama': {
        const base = this.normalizeProviderBaseUrl('ollama', normalizedConfig?.baseUrl || getRuntimeConfig().ollamaUrl);
        return new OllamaProvider(m, base, apiKey || undefined);
      }
      case 'ollama_cloud': {
        const base = this.normalizeProviderBaseUrl('ollama_cloud', normalizedConfig?.baseUrl || 'https://ollama.com');
        return new OllamaProvider(m, base, apiKey || undefined);
      }
      case 'gemini':
        return new GeminiProvider(apiKey || '', m);
      case 'openai':
        return new OpenAIProvider(
          m,
          apiKey || '',
          this.normalizeProviderBaseUrl('openai', normalizedConfig?.baseUrl),
        );
      case 'mistral':
      case 'groq':
        return new OpenAIProvider(
          m,
          apiKey || '',
          this.normalizeProviderBaseUrl(normalizedConfig?.provider || config.provider, normalizedConfig?.baseUrl),
        );
      default:
        if ((normalizedConfig?.provider || config.provider) !== 'ollama') {
          return new OpenAIProvider(
            m,
            apiKey || '',
            this.normalizeProviderBaseUrl('openai', normalizedConfig?.baseUrl),
          );
        }
        return new OllamaProvider(m, getRuntimeConfig().ollamaUrl, apiKey || undefined);
    }
  }

    static async getProvider(providerId?: string, overriddenModel?: string): Promise<ILLMProvider> {
        const config = await this.getProviderConfig(providerId);

    if (!config) {
      logger.warn({
        scope: 'llm.factory',
        message: 'No active provider linked. Falling back to local Ollama.',
        model: overriddenModel || 'llama3',
      });
      return new OllamaProvider(overriddenModel || 'llama3', getRuntimeConfig().ollamaUrl);
    }
    return this.createProviderFromConfig(config, overriddenModel);
  }

    static async getDefaultProvider(): Promise<ILLMProvider> {
    return this.getProvider();
  }
}
