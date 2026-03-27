import { db } from '../../db';
import { providerConfigs } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { ILLMProvider } from './provider.interface';
import { OllamaProvider } from './ollama.provider';
import { GeminiProvider } from './gemini.provider';
import { OpenAIProvider } from './openai.provider';

export class LLMFactory {
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
    if (!m || m === 'dynamic') {
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

  static async getProvider(providerId?: string, overriddenModel?: string): Promise<ILLMProvider> {
    let config;
    if (providerId) {
      config = await db.query.providerConfigs.findFirst({
        where: eq(providerConfigs.id, providerId)
      });
    }

    if (!config) {
      config = await db.query.providerConfigs.findFirst({
        where: eq(providerConfigs.isDefault, true)
      });
    }

    if (!config) {
      console.warn('[LLMFactory] No active provider linked. Falling back to local Ollama (llama3).');
      return new OllamaProvider(overriddenModel || 'llama3', process.env.OLLAMA_URL || 'http://localhost:11434');
    }

    const m = this.resolveModel(config.provider, config.model, overriddenModel);

    switch (config.provider) {
      case 'ollama': {
        const base = this.normalizeProviderBaseUrl('ollama', config.baseUrl || process.env.OLLAMA_URL || 'http://localhost:11434');
        return new OllamaProvider(m, base, config.apiKey || undefined);
      }
      case 'ollama_cloud': {
        const base = this.normalizeProviderBaseUrl('ollama_cloud', config.baseUrl || 'https://ollama.com');
        return new OllamaProvider(m, base, config.apiKey || undefined);
      }
      case 'gemini':
        return new GeminiProvider(config.apiKey || '', m);
      case 'openai':
        return new OpenAIProvider(
          m,
          config.apiKey || '',
          this.normalizeProviderBaseUrl('openai', config.baseUrl)
        );
      case 'mistral':
      case 'groq':
        return new OpenAIProvider(
          m,
          config.apiKey || '',
          this.normalizeProviderBaseUrl(config.provider, config.baseUrl)
        );
      default:
        // By default use OpenAI target if not matched, or Ollama
        if (config.provider !== 'ollama') {
          return new OpenAIProvider(
            m,
            config.apiKey || '',
            this.normalizeProviderBaseUrl('openai', config.baseUrl)
          );
        }
        return new OllamaProvider(m, 'http://localhost:11434');
    }
  }

  static async getDefaultProvider(): Promise<ILLMProvider> {
    return this.getProvider();
  }
}
