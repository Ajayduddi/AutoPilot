/**
 * @fileoverview providers/llm/llm.factory.
 *
 * External provider adapters and interfaces for LLMs and workflow engines.
 */
import { db } from '../../db';
import { providerConfigs } from '../../db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { ILLMProvider } from './provider.interface';
import { OllamaProvider } from './ollama.provider';
import { GeminiProvider } from './gemini.provider';
import { OpenAIProvider } from './openai.provider';
import { getRuntimeConfig } from '../../config/runtime.config';
import { logger } from '../../util/logger';

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
  private static readonly PROVIDER_KEY_ENCRYPTION_KEY = process.env.PROVIDER_API_KEY_ENCRYPTION_KEY || '';
  private static readonly PROVIDER_KEY_PREFIX = 'enc:v1:';

    private static deriveProviderKey(): Buffer | null {
    if (!this.PROVIDER_KEY_ENCRYPTION_KEY.trim()) return null;
    return crypto.createHash('sha256').update(this.PROVIDER_KEY_ENCRYPTION_KEY).digest();
  }

    static decryptProviderApiKey(stored?: string | null): string | null {
    if (!stored) return null;
    if (!stored.startsWith(this.PROVIDER_KEY_PREFIX)) return stored;
        const key = this.deriveProviderKey();
    if (!key) return null;
        const raw = stored.slice(this.PROVIDER_KEY_PREFIX.length);
    const [ivB64, dataB64, tagB64] = raw.split(':');
    if (!ivB64 || !dataB64 || !tagB64) return null;
    try {
            const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(ivB64, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
            const decrypted = Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64url')),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch {
      return null;
    }
  }

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
            const byId = await db.query.providerConfigs.findFirst({
        where: eq(providerConfigs.id, providerId.trim()),
      });
      if (byId) return byId;
    }

        const byDefault = await db.query.providerConfigs.findFirst({
      where: eq(providerConfigs.isDefault, true),
    });
    if (byDefault) return byDefault;

        const first = await db.query.providerConfigs.findFirst();
    return first || null;
  }

  static createProviderFromConfig(
    config: typeof providerConfigs.$inferSelect,
    overriddenModel?: string,
  ): ILLMProvider {
        const m = this.resolveModel(config.provider, config.model, overriddenModel);
        const apiKey = this.decryptProviderApiKey(config.apiKey);

    switch (config.provider) {
      case 'ollama': {
                const base = this.normalizeProviderBaseUrl('ollama', config.baseUrl || getRuntimeConfig().ollamaUrl);
        return new OllamaProvider(m, base, apiKey || undefined);
      }
      case 'ollama_cloud': {
                const base = this.normalizeProviderBaseUrl('ollama_cloud', config.baseUrl || 'https://ollama.com');
        return new OllamaProvider(m, base, apiKey || undefined);
      }
      case 'gemini':
        return new GeminiProvider(apiKey || '', m);
      case 'openai':
        return new OpenAIProvider(
          m,
          apiKey || '',
          this.normalizeProviderBaseUrl('openai', config.baseUrl),
        );
      case 'mistral':
      case 'groq':
        return new OpenAIProvider(
          m,
          apiKey || '',
          this.normalizeProviderBaseUrl(config.provider, config.baseUrl),
        );
      default:
        if (config.provider !== 'ollama') {
          return new OpenAIProvider(
            m,
            apiKey || '',
            this.normalizeProviderBaseUrl('openai', config.baseUrl),
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
